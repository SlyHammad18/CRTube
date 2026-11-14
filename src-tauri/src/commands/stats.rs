use std::sync::Arc;

use serde::Deserialize;
use tauri::State;

use crate::services::db::Db;
use crate::services::stats as svc;

/// Listening-segment flush from the frontend recorder. Fields mirror
/// `services::stats::ListenEvent`; stream metadata is optional and only
/// recorded when the video isn't in the library.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenEvent {
    pub video_id: String,
    pub seconds: f64,
    pub completed: bool,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub thumb_url: Option<String>,
}

/// Record a played-seconds segment (called every ~15s of listening and at
/// each listening-session end). Firing void from the frontend: errors are
/// surfaced as command failures but never break playback.
#[tauri::command]
pub fn stats_record_listen(
    db: State<'_, Arc<Db>>,
    ev: ListenEvent,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    svc::record_segment(
        &conn,
        &svc::ListenEvent {
            video_id: ev.video_id,
            seconds: ev.seconds,
            completed: ev.completed,
            title: ev.title,
            channel: ev.channel,
            thumb_url: ev.thumb_url,
        },
    )
    .map_err(|e| e.to_string())
}

/// Totals for the current window: listening time, play count (≥30s listens),
/// distinct tracks played.
#[tauri::command]
pub fn stats_overview(
    db: State<'_, Arc<Db>>,
    range: svc::Range,
) -> Result<svc::Overview, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    svc::overview(&conn, range).map_err(|e| e.to_string())
}

/// Top listened tracks for the window (title/channel resolve through the
/// library; stream-only events carry their own metadata).
#[tauri::command]
pub fn stats_top_tracks(
    db: State<'_, Arc<Db>>,
    range: svc::Range,
    limit: Option<i64>,
) -> Result<Vec<svc::TopTrack>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    svc::top_tracks(&conn, range, limit.unwrap_or(10))
        .map_err(|e| e.to_string())
}

/// Top listened artists (normalized artist tables for library tracks,
/// recorded channel strings for stream-only events).
#[tauri::command]
pub fn stats_top_artists(
    db: State<'_, Arc<Db>>,
    range: svc::Range,
    limit: Option<i64>,
) -> Result<Vec<svc::TopArtist>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    svc::top_artists(&conn, range, limit.unwrap_or(10))
        .map_err(|e| e.to_string())
}

/// Zero-filled date buckets for the listening-time chart covering the window.
#[tauri::command]
pub fn stats_timeline(
    db: State<'_, Arc<Db>>,
    range: svc::Range,
) -> Result<Vec<svc::Bucket>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    svc::timeline(&conn, range).map_err(|e| e.to_string())
}
