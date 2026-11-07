use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use super::installer;
use super::ytdlp::{self, StreamKind, StreamSource};

/// How long a resolved upstream URL stays trusted. YouTube stream URLs are
/// signed and expire after a few hours; a shorter TTL keeps previews fresh
/// without re-probing on every seek.
const SESSION_TTL: Duration = Duration::from_secs(30 * 60);

/// Upper bound for how long a caller waits on another task's in-flight
/// extraction (matches the yt-dlp probe timeout plus slack).
const WAIT_STEPS: usize = 250;
const WAIT_STEP: Duration = Duration::from_millis(300);

/// Cache of resolved remote-stream sources per `(video_id, kind)`, shared by
/// the `stream_media_url` command (populates) and the loopback proxy route
/// (consumes). Guarded by a sync `Mutex` — the proxy handler only does quick
/// map lookups under it.
#[derive(Default)]
pub struct StreamSessions {
    map: Mutex<HashMap<(String, StreamKind), (Instant, StreamSource)>>,
    in_flight: tokio::sync::Mutex<HashSet<(String, StreamKind)>>,
}

impl StreamSessions {
    /// Fresh session for `(video_id, kind)`, or `None` when absent/expired.
    pub fn lookup(&self, video_id: &str, kind: StreamKind) -> Option<StreamSource> {
        let map = self.map.lock().ok()?;
        let (at, src) = map.get(&(video_id.to_string(), kind))?;
        (at.elapsed() < SESSION_TTL).then(|| src.clone())
    }

    fn insert(&self, video_id: &str, kind: StreamKind, src: StreamSource) {
        if let Ok(mut map) = self.map.lock() {
            map.insert((video_id.to_string(), kind), (Instant::now(), src));
        }
    }

    pub fn invalidate(&self, video_id: &str, kind: StreamKind) {
        if let Ok(mut map) = self.map.lock() {
            map.remove(&(video_id.to_string(), kind));
        }
    }

    /// Point an existing session at a fresh upstream URL (redirect hops).
    /// Keeps the original TTL stamp — a redirect must not extend the session.
    pub fn update_url(&self, video_id: &str, kind: StreamKind, url: String) {
        if let Ok(mut map) = self.map.lock() {
            if let Some(entry) = map.get_mut(&(video_id.to_string(), kind)) {
                entry.1.url = url;
            }
        }
    }
}

/// Strict YouTube id shape — 11 chars of `[A-Za-z0-9_-]`. The proxy route
/// addresses streams by id only, so a malformed id must never reach yt-dlp.
fn valid_video_id(video_id: &str) -> bool {
    video_id.len() == 11
        && video_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Return a resolved stream source, reusing a fresh cache entry when present.
/// `force` drops the cached entry first (used by the webview's one-shot retry
/// after an expired-URL error). Concurrent requests for the same key share one
/// yt-dlp extraction — later callers poll the cache until it lands.
pub async fn ensure(
    app: &AppHandle,
    video_id: &str,
    kind: StreamKind,
    force: bool,
    cookie: &str,
    cookie_file: &str,
) -> Result<StreamSource, String> {
    if !valid_video_id(video_id) {
        return Err("that doesn't look like a YouTube video".into());
    }
    let sessions = app.state::<StreamSessions>();
    if force {
        sessions.invalidate(video_id, kind);
    } else if let Some(src) = sessions.lookup(video_id, kind) {
        return Ok(src);
    }

    let key = (video_id.to_string(), kind);
    let wait = {
        let mut guard = sessions.in_flight.lock().await;
        !guard.insert(key.clone())
    };
    if wait {
        // Another task is extracting this exact stream — piggyback on it.
        for _ in 0..WAIT_STEPS {
            tokio::time::sleep(WAIT_STEP).await;
            if let Some(src) = sessions.lookup(video_id, kind) {
                return Ok(src);
            }
        }
        return Err("still resolving this stream — try again in a moment".into());
    }

    let result = extract(app, video_id, kind, cookie, cookie_file).await;
    sessions.in_flight.lock().await.remove(&key);
    match result {
        Ok(src) => {
            sessions.insert(video_id, kind, src.clone());
            Ok(src)
        }
        Err(e) => Err(e),
    }
}

async fn extract(
    app: &AppHandle,
    video_id: &str,
    kind: StreamKind,
    cookie: &str,
    cookie_file: &str,
) -> Result<StreamSource, String> {
    let bin = installer::bin_dir(app).map_err(|e| e.to_string())?;
    ytdlp::extract_stream_source(&bin, video_id, kind, cookie, cookie_file)
        .await
        .map_err(|e| e.to_string())
}
