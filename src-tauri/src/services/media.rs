use std::collections::HashSet;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rusqlite::params;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::process::Command as TokioCommand;

use super::db::Db;
use crate::services::installer;

/// Loopback-only streaming server that feeds the webview's media element
/// (DESIGN §4.9/§5.6). WebKitGTK's GStreamer pipeline cannot fetch from
/// custom URI schemes (`asset://`), so downloaded media is served over
/// `http://127.0.0.1:{port}/{token}/{download_id}` with Range support.
///
/// Security posture: binds to loopback only, requires an unpredictable
/// per-session token as the first path segment, addresses files strictly by
/// their `downloads.id`, and re-validates the resolved path against the
/// configured media roots before serving.
const MAX_HEADER_BYTES: usize = 16 * 1024;
const CHUNK: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct MediaServer {
    pub port: u16,
    pub token: String,
    pub roots: Arc<tokio::sync::RwLock<Vec<PathBuf>>>,
    /// Guards in-flight transcodes so only one ffmpeg writes a given cache
    /// file (prevents the double-encode / corruption race from concurrent
    /// requests for the same video).
    pub transcoding: Arc<tokio::sync::Mutex<HashSet<i64>>>,
}

/// Pure: parse a single-range `Range: bytes=...` header against a file length.
/// Returns `(start, end_inclusive)` or None when absent/malformed/multi-range.
pub fn parse_range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let h = header?.trim();
    let spec = h.strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None; // multi-range unsupported; callers fall back to 200
    }
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        // suffix range: last N bytes
        let n: u64 = end_s.parse().ok()?;
        if n == 0 || len == 0 {
            return None;
        }
        let n = n.min(len);
        return Some((len - n, len - 1));
    }
    let start: u64 = start_s.parse().ok()?;
    let end: u64 = if end_s.is_empty() {
        len.saturating_sub(1)
    } else {
        end_s.parse().ok()?
    };
    if len == 0 || start > end || start >= len {
        return None;
    }
    Some((start, end.min(len - 1)))
}

/// Pure: best-effort Content-Type for downloaded containers.
pub fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Probe the video codec of a file via ffprobe. Returns `None` when there is
/// no *real* video stream (audio-only files, or embedded cover art reported as
/// an attached-picture `video` stream) or ffprobe is unavailable/fails.
pub fn probe_video_codec(path: &Path, ffprobe: &Path) -> Option<String> {
    if !ffprobe.exists() {
        return None;
    }
    let out = std::process::Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,disposition:attached_pic",
            "-of",
            "csv=p=0",
            &path.to_string_lossy(),
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // `codec_name,attached_pic` — e.g. `h264,0` or `mjpeg,1` (cover art).
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if line.is_empty() {
        return None;
    }
    let mut parts = line.split(',');
    let codec = parts.next()?.to_string();
    let attached_pic = parts.next().unwrap_or("0").trim() == "1";
    if attached_pic {
        return None; // embedded cover art, not a playable video track
    }
    if codec.is_empty() {
        None
    } else {
        Some(codec)
    }
}

/// Whether a video stream + container can be played directly by WebKitGTK's
/// `<video>` element. Only H.264 in an MP4/M4V container is reliably decodable
/// on Linux; AV1/HEVC/ProRes/etc. must be transcoded.
pub fn is_web_playable_video(codec: &str, container: &str) -> bool {
    let c = codec.to_ascii_lowercase();
    let is_h264 = c.starts_with("h264") || c.starts_with("avc");
    let good_container = matches!(container, "mp4" | "m4v");
    is_h264 && good_container
}

fn next_nonce() -> u64 {
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

pub fn generate_token() -> String {
    let mut h = Sha256::new();
    h.update(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0).to_le_bytes());
    h.update(std::process::id().to_le_bytes());
    h.update(next_nonce().to_le_bytes());
    let digest = h.finalize();
    hex::encode(&digest[..12])
}

impl MediaServer {
    /// Bind on an ephemeral loopback port and start accepting forever.
    pub async fn spawn(app: AppHandle, roots: Vec<PathBuf>) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let server = Self {
            port,
            token: generate_token(),
            roots: Arc::new(tokio::sync::RwLock::new(roots)),
            transcoding: Arc::new(tokio::sync::Mutex::new(HashSet::new())),
        };

        let token = server.token.clone();
        let roots_shared = server.roots.clone();
        let transcoding = server.transcoding.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _addr)) => {
                        let token = token.clone();
                        let roots = roots_shared.clone();
                        let transcoding = transcoding.clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) =
                                serve_connection(stream, app, token, roots, transcoding).await
                            {
                                eprintln!("crtube media-server: {e}");
                            }
                        });
                    }
                    Err(e) => eprintln!("crtube media-server accept: {e}"),
                }
            }
        });
        Ok(server)
    }

    pub fn url_for(&self, download_id: i64) -> String {
        format!("http://127.0.0.1:{}/{}/{}", self.port, self.token, download_id)
    }

    /// URL that triggers an on-the-fly ffmpeg transcode to H.264/AAC (used for
    /// codecs WebKitGTK cannot decode, e.g. AV1/HEVC). Path: /{token}/t/{id}.
    pub fn transcode_url_for(&self, download_id: i64) -> String {
        format!("http://127.0.0.1:{}/{}/t/{}", self.port, self.token, download_id)
    }

    pub async fn set_roots(&self, roots: Vec<PathBuf>) {
        *self.roots.write().await = roots;
    }
}

struct Request {
    want_body: bool,
    range: Option<String>,
    /// First path segment — must equal the session token.
    token: String,
    id: Option<i64>,
    /// `/{token}/t/{id}` requests an ffmpeg transcode instead of passthrough.
    transcode: bool,
}

async fn read_request<S>(stream: &mut S) -> Result<Option<Request>, String>
where
    S: tokio::io::AsyncRead + Unpin,
{
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        if buf.len() > MAX_HEADER_BYTES {
            return Err("header too large".into());
        }
        let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(None); // client closed early
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).rposition(|w| w == b"\r\n\r\n").is_some() {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_uppercase();
    let target = parts.next().unwrap_or_default().to_string();
    let _version = parts.next();

    let mut range = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("range") {
            range = Some(value.trim().to_string());
        }
    }

    // Target shape: /{token}/{id}  or  /{token}/t/{id} (transcode)
    let segments: Vec<&str> = target.trim_matches('/').split('/').collect();
    let token = segments.first().copied().unwrap_or_default().to_string();
    let (transcode, id) = match segments.len() {
        3 if segments.get(1) == Some(&"t") => (true, segments.get(2).and_then(|s| s.parse::<i64>().ok())),
        2 => (false, segments.get(1).and_then(|s| s.parse::<i64>().ok())),
        _ => (false, None),
    };

    Ok(Some(Request {
        want_body: method != "HEAD",
        range,
        token,
        id,
        transcode,
    }))
}

async fn serve_connection(
    mut stream: tokio::net::TcpStream,
    app: AppHandle,
    token: String,
    roots: Arc<tokio::sync::RwLock<Vec<PathBuf>>>,
    transcoding: Arc<tokio::sync::Mutex<HashSet<i64>>>,
) -> Result<(), String> {
    let Some(req) = read_request(&mut stream).await? else {
        return Ok(());
    };

    // Token gate: length-checked byte equality without early exit.
    if !secure_eq(req.token.as_bytes(), token.as_bytes()) {
        return respond_text(&mut stream, 404, "not found").await;
    }
    let Some(id) = req.id else {
        return respond_text(&mut stream, 404, "not found").await;
    };

    // Resolve path from the DB (never trust client-supplied paths).
    let db = app.state::<Arc<Db>>();
    let path: Option<String> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT path FROM downloads WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok()
    };
    let Some(raw_path) = path.filter(|p| !p.trim().is_empty()) else {
        return respond_text(&mut stream, 404, "not found").await;
    };

    // Confine to configured roots (canonicalised both sides where possible).
    let resolved = std::fs::canonicalize(&raw_path).unwrap_or(PathBuf::from(&raw_path));
    let allowed = roots.read().await.iter().any(|root| {
        let root_canon = std::fs::canonicalize(root).unwrap_or_else(|_| root.clone());
        resolved.starts_with(&root_canon)
    });
    if !allowed {
        return respond_text(&mut stream, 403, "forbidden").await;
    }

    if req.transcode {
        return serve_transcode(stream, app, id, resolved, req.range, req.want_body, transcoding)
            .await;
    }
    serve_file(stream, resolved, req.range, req.want_body).await
}

/// Serve a file over HTTP with proper `Range` support (206 / 200).
async fn serve_file<S>(
    mut stream: S,
    path: PathBuf,
    range: Option<String>,
    want_body: bool,
) -> Result<(), String>
where
    S: tokio::io::AsyncWrite + Unpin,
{
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| e.to_string())?;
    let len = file.metadata().await.map_err(|e| e.to_string())?.len();
    let ct = content_type_for(&path);

    match parse_range(range.as_deref(), len) {
        Some((start, end)) => {
            let mut file = file;
            file.seek(SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;
            let nbytes = end - start + 1;
            let head = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Type: {ct}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{len}\r\nContent-Length: {nbytes}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(head.as_bytes()).await.ok();
            if want_body {
                copy_n(&mut file, &mut stream, nbytes).await;
            }
        }
        None => {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {ct}\r\nAccept-Ranges: bytes\r\nContent-Length: {len}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(head.as_bytes()).await.ok();
            if want_body {
                let mut file = file;
                tokio::io::copy(&mut file, &mut stream).await.ok();
            }
        }
    }
    stream.flush().await.ok();
    Ok(())
}

/// Transcode a download to H.264/AAC and serve it to the webview. The result
/// is cached to `<app_data>/transcodes/{id}.mp4` (with a sibling `{id}.done`
/// marker) so repeat plays are instant and fully seekable via `serve_file`'s
/// Range support. WebKitGTK cannot decode AV1/HEVC, which is why this path
/// exists (audio still plays, video is black otherwise).
///
/// Streaming strategy: the first request for an uncached id becomes the
/// "owner", spawns a single ffmpeg that writes the cache file, and streams
/// that *growing* file RAW (a `200` with no `Content-Length`) so playback
/// starts immediately. Seeks (non-open-ended Range requests) wait for the
/// `{id}.done` marker, then are served the completed file via `serve_file`
/// (full `Range` support). This avoids both the old bare-`200` stall and the
/// partial-cache `206` with a bogus total size.
async fn serve_transcode<S>(
    mut stream: S,
    app: AppHandle,
    id: i64,
    path: PathBuf,
    range: Option<String>,
    want_body: bool,
    transcoding: Arc<tokio::sync::Mutex<HashSet<i64>>>,
) -> Result<(), String>
where
    S: tokio::io::AsyncWrite + Unpin,
{
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("transcodes");
    std::fs::create_dir_all(&cache_dir).ok();
    let cache = cache_dir.join(format!("{id}.mp4"));
    let done = cache_dir.join(format!("{id}.done"));

    // Fast path: a completed transcode already exists — serve it statically
    // with full Range support (instant + seekable).
    if cache.exists() && done.exists() {
        return serve_file(stream, cache, range, want_body).await;
    }

    // HEAD: report availability without running a full transcode.
    if !want_body {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        stream.write_all(head.as_bytes()).await.ok();
        stream.flush().await.ok();
        return Ok(());
    }

    // Serialize transcodes per id: only the owner spawns ffmpeg.
    let owner = {
        let mut g = transcoding.lock().await;
        if g.contains(&id) {
            false
        } else {
            g.insert(id);
            true
        }
    };

    if !owner {
        wait_for_done(&done, std::time::Duration::from_secs(600)).await;
        return serve_file(stream, cache, range, want_body).await;
    }

    // Owner: drop any stale cache, then transcode to the cache file only
    // (no second `-` stdout output — that double-encoded and produced the
    // broken live stream).
    let _ = std::fs::remove_file(&cache);
    let _ = std::fs::remove_file(&done);

    let bin = match installer::bin_dir(&app) {
        Ok(b) => b,
        Err(_) => {
            remove_transcoding(&transcoding, id).await;
            return respond_text(&mut stream, 500, "transcode unavailable").await;
        }
    };
    let _ = installer::ensure_ffmpeg(&app, &bin).await;
    let ffmpeg = installer::ffmpeg_path(&bin);
    if !ffmpeg.exists() {
        remove_transcoding(&transcoding, id).await;
        return respond_text(&mut stream, 500, "ffmpeg missing").await;
    }

    let cache_arg = cache.to_str().unwrap_or("/dev/null").to_string();
    let path_arg = path.to_str().unwrap_or("").to_string();
    let mut child = TokioCommand::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-i",
            &path_arg,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+frag_keyframes+empty_moov",
            "-f",
            "mp4",
            &cache_arg,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    // Stream the *growing* cache file RAW (a `200` with no `Content-Length`).
    // This is what makes WebKitGTK start playback immediately; because we
    // follow EOF and only close once ffmpeg has finished, the browser receives
    // the entire file and plays to the end. Any Range request (incl. a size
    // probe) is answered with this stream — WebKit falls back to full-stream
    // playback and starts at once. Precise seeking works automatically once
    // the `{id}.done` marker exists (the fast path serves a correct `206`).
    // If the client disconnects mid-transcode we still let ffmpeg finish so the
    // cache is populated for everyone else.
    if let Err(e) = stream_growing_raw(&mut stream, &cache, &mut child).await {
        let _ = child.wait().await;
        remove_transcoding(&transcoding, id).await;
        return Err(e);
    }

    let _ = child.wait().await;
    let _ = std::fs::write(&done, b"1");
    remove_transcoding(&transcoding, id).await;
    stream.flush().await.ok();
    Ok(())
}

/// Stream a file that is still being written (by ffmpeg) to the client as a
/// raw `200` stream (no `Content-Length`, `Connection: close`). WebKitGTK
/// starts playback on such a stream, and because we follow EOF and only close
/// once ffmpeg has finished, the browser receives the entire file and plays to
/// the end. (Chunked transfer encoding was tried but WebKitGTK's GStreamer
/// source would not begin playback on it.)
async fn stream_growing_raw<S>(
    stream: &mut S,
    cache: &Path,
    child: &mut tokio::process::Child,
) -> Result<(), String>
where
    S: tokio::io::AsyncWrite + Unpin,
{
    let head = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
    stream.write_all(head.as_bytes()).await.map_err(|e| e.to_string())?;

    // Wait for ffmpeg to create the cache file.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        if cache.exists() {
            break;
        }
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err("transcode produced no output".into());
        }
        if tokio::time::Instant::now() > deadline {
            return Err("transcode start timed out".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let mut file = tokio::fs::File::open(cache)
        .await
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; CHUNK];
    loop {
        match file.read(&mut buf).await {
            Ok(0) => {
                // Reached the current end of file. If ffmpeg has finished, so
                // have we; otherwise more bytes are coming — brief backoff.
                if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            }
            Ok(n) => {
                stream.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    stream.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Poll until the `{id}.done` marker appears or the timeout elapses.
async fn wait_for_done(done: &Path, timeout: std::time::Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if done.exists() {
            return;
        }
        if tokio::time::Instant::now() > deadline {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Release the per-id transcode lock.
async fn remove_transcoding(set: &Arc<tokio::sync::Mutex<HashSet<i64>>>, id: i64) {
    let mut g = set.lock().await;
    g.remove(&id);
}

fn secure_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn copy_n<S, W>(file: &mut S, out: &mut W, mut n: u64)
where
    S: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; CHUNK];
    while n > 0 {
        let want = n.min(CHUNK as u64) as usize;
        match file.read(&mut buf[..want]).await {
            Ok(0) => break,
            Ok(got) => {
                if out.write_all(&buf[..got]).await.is_err() {
                    break;
                }
                n -= got as u64;
            }
            Err(_) => break,
        }
    }
}

async fn respond_text<W>(stream: &mut W, status: u16, body: &str) -> Result<(), String>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        status,
        if status == 404 { "Not Found" } else { "Error" },
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_full_and_open_ended() {
        assert_eq!(parse_range(Some("bytes=0-99"), 1000), Some((0, 99)));
        assert_eq!(parse_range(Some("bytes=500-"), 1000), Some((500, 999)));
    }

    #[test]
    fn range_end_clamped_to_len() {
        assert_eq!(parse_range(Some("bytes=900-2000"), 1000), Some((900, 999)));
    }

    #[test]
    fn range_suffix() {
        assert_eq!(parse_range(Some("bytes=-100"), 1000), Some((900, 999)));
        // Suffix larger than file → whole file.
        assert_eq!(parse_range(Some("bytes=-5000"), 1000), Some((0, 999)));
    }

    #[test]
    fn range_invalid_cases() {
        assert_eq!(parse_range(None, 1000), None);
        assert_eq!(parse_range(Some("bytes=5-2"), 1000), None); // inverted
        assert_eq!(parse_range(Some("bytes=1000-"), 1000), None); // start past EOF
        assert_eq!(parse_range(Some("bytes=0-10,20-30"), 1000), None); // multi-range
        assert_eq!(parse_range(Some("items=0-5"), 1000), None); // wrong unit
        assert_eq!(parse_range(Some("bytes=-"), 1000), None);
        assert_eq!(parse_range(Some("bytes=0-9"), 0), None); // empty file
    }

    #[test]
    fn content_types_cover_download_containers() {
        use PathBuf as P;
        assert_eq!(content_type_for(&P::from("a.mp3")), "audio/mpeg");
        assert_eq!(content_type_for(&P::from("b.mp4")), "video/mp4");
        assert_eq!(content_type_for(&P::from("c.webm")), "video/webm");
        assert_eq!(content_type_for(&P::from("d.mkv")), "video/x-matroska");
        assert_eq!(content_type_for(&P::from("e.M4A")), "video/mp4");
        assert_eq!(content_type_for(&P::from("f.xyz")), "application/octet-stream");
    }

    #[test]
    fn token_is_hex_and_unique() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 24);
        assert_ne!(a, b);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
    }
}
