use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rusqlite::params;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::db::Db;

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
        };

        let token = server.token.clone();
        let roots_shared = server.roots.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _addr)) => {
                        let token = token.clone();
                        let roots = roots_shared.clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = serve_connection(stream, app, token, roots).await {
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

    // Target shape: /{token}/{id}
    let segments: Vec<&str> = target.trim_matches('/').split('/').collect();
    let token = segments.first().copied().unwrap_or_default().to_string();
    let id = segments
        .get(1)
        .and_then(|s| s.parse::<i64>().ok());

    Ok(Some(Request {
        want_body: method != "HEAD",
        range,
        token,
        id,
    }))
}

async fn serve_connection(
    mut stream: tokio::net::TcpStream,
    app: AppHandle,
    token: String,
    roots: Arc<tokio::sync::RwLock<Vec<PathBuf>>>,
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

    let file = tokio::fs::File::open(&resolved)
        .await
        .map_err(|e| e.to_string())?;
    let meta = file.metadata().await.map_err(|e| e.to_string())?;
    let len = meta.len();
    let ct = content_type_for(&resolved);

    match parse_range(req.range.as_deref(), len) {
        Some((start, end)) => {
            let mut file = file;
            file.seek(SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;
            let nbytes = end - start + 1;
            let head = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Type: {ct}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{len}\r\nContent-Length: {nbytes}\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(head.as_bytes()).await.ok();
            if req.want_body {
                copy_n(&mut file, &mut stream, nbytes).await;
            }
        }
        None => {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {ct}\r\nAccept-Ranges: bytes\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(head.as_bytes()).await.ok();
            if req.want_body {
                let mut file = file;
                tokio::io::copy(&mut file, &mut stream).await.ok();
            }
        }
    }
    stream.flush().await.ok();
    Ok(())
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
