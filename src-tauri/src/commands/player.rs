use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::services::db::{self, Db, Playlist, PlaylistTrack};
use crate::services::installer;
use crate::services::lyrics::{self, LyricsCandidate, LyricsPayload};
use crate::services::media;

const PLAYLIST_NAME_MAX: usize = 80;

fn clean_playlist_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("playlist name cannot be empty".into());
    }
    if name.len() > PLAYLIST_NAME_MAX {
        return Err(format!("playlist name too long (max {PLAYLIST_NAME_MAX} chars)"));
    }
    Ok(name.to_string())
}

#[tauri::command]
pub fn list_playlists(db: State<'_, Arc<Db>>) -> Result<Vec<Playlist>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_playlist(db: State<'_, Arc<Db>>, name: String) -> Result<Playlist, String> {
    let name = clean_playlist_name(&name)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::create_playlist(&conn, &name).map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            "a playlist with this name already exists".to_string()
        } else {
            e.to_string()
        }
    })
}

#[tauri::command]
pub fn rename_playlist(db: State<'_, Arc<Db>>, id: i64, name: String) -> Result<(), String> {
    let name = clean_playlist_name(&name)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::rename_playlist(&conn, id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_playlist(db: State<'_, Arc<Db>>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::delete_playlist(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_playlist_item(
    db: State<'_, Arc<Db>>,
    playlist_id: i64,
    download_id: i64,
) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::add_playlist_item(&conn, playlist_id, download_id).map_err(|e| {
        if e.to_string().contains("FOREIGN KEY") {
            "track or playlist no longer exists".to_string()
        } else {
            e.to_string()
        }
    })
}

#[tauri::command]
pub fn remove_playlist_item(db: State<'_, Arc<Db>>, item_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::remove_playlist_item(&conn, item_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_playlist_items(
    db: State<'_, Arc<Db>>,
    playlist_id: i64,
) -> Result<Vec<PlaylistTrack>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_playlist_items(&conn, playlist_id).map_err(|e| e.to_string())
}

/// All playlist memberships in one query (playlist_id, download_id, item_id).
#[tauri::command]
pub fn list_playlist_memberships(
    db: State<'_, Arc<Db>>,
) -> Result<Vec<(i64, i64, i64)>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_playlist_memberships(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_playlist_items(
    db: State<'_, Arc<Db>>,
    playlist_id: i64,
    item_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::reorder_playlist_items(&conn, playlist_id, &item_ids).map_err(|e| e.to_string())
}

/// Loopback stream URL for a download; `Ok(None)` when the row or file is gone.
#[tauri::command]
pub async fn media_url(
    app: AppHandle,
    server: State<'_, media::MediaServer>,
    db: State<'_, Arc<Db>>,
    id: i64,
) -> Result<Option<String>, String> {
    // Extract data from under the lock so the MutexGuard is dropped before any await.
    let (path, kind) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT path, kind FROM downloads WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        match row
            .filter(|(p, _)| !p.trim().is_empty() && Path::new(p.trim()).is_file())
        {
            Some((p, k)) => (p, k),
            None => return Ok(None),
        }
    };
    // Only video can need transcoding; audio (incl. files with embedded cover
    // art, which ffprobe reports as a `video` stream) always passes through.
    if kind != "video" {
        return Ok(Some(server.url_for(id)));
    }
    let path_ref = Path::new(path.trim());
    let container = path_ref
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    // WebKitGTK cannot decode many codecs (AV1/HEVC/…); for those, stream a
    // transcoded H.264/AAC copy instead so playback (and controls) actually work.
    let needs_transcode = if let Ok(bin) = installer::bin_dir(&app) {
        let ffprobe = installer::ffprobe_path(&bin);
        match media::probe_video_codec_async(path_ref.to_path_buf(), ffprobe).await {
            Some(codec) => !media::is_web_playable_video(&codec, &container),
            None => false, // audio-only, or probe failed -> passthrough
        }
    } else {
        false
    };

    let url = if needs_transcode {
        server.transcode_url_for(id)
    } else {
        server.url_for(id)
    };
    Ok(Some(url))
}

/// Loopback URL for a cached thumbnail, published as OS media-session artwork
/// (MPRIS on Linux). `Ok(None)` when the thumbnail isn't cached yet — the
/// caller should then omit artwork rather than publish a 404.
#[tauri::command]
pub fn thumb_media_url(
    app: AppHandle,
    server: State<'_, media::MediaServer>,
    video_id: String,
) -> Result<Option<String>, String> {
    let thumb = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs")
        .join(format!("{video_id}.jpg"));
    if !thumb.is_file() {
        return Ok(None);
    }
    Ok(Some(server.thumb_url_for(&video_id)))
}

/// LRCLIB lookup for a track; cache-first, returns `Ok(None)` when nothing found.
#[tauri::command]
pub async fn fetch_lyrics(
    app: AppHandle,
    video_id: String,
    title: String,
    channel: Option<String>,
    duration_s: Option<u64>,
) -> Result<Option<LyricsPayload>, String> {
    lyrics::fetch_lyrics(
        &app,
        video_id.trim(),
        &title,
        channel.as_deref(),
        duration_s,
    )
    .await
}

/// LRCLIB search — returns all candidate matches so the UI can offer multiple.
#[tauri::command]
pub async fn search_lyrics(query: String) -> Result<Vec<LyricsCandidate>, String> {
    lyrics::search_lyrics(&query).await
}

/// Persist a user-selected/edited lyric set for a track (sticky per-song override).
#[tauri::command]
pub fn set_lyrics(app: AppHandle, video_id: String, payload: LyricsPayload) -> Result<(), String> {
    lyrics::set_lyrics(&app, &video_id, &payload)
}

/// Remove a stored lyric override so auto-fetch resumes.
#[tauri::command]
pub fn clear_lyrics(app: AppHandle, video_id: String) -> Result<(), String> {
    lyrics::clear_lyrics(&app, &video_id)
}

/// Persist a user-tuned lyric sync offset (ms) for a track.
#[tauri::command]
pub fn set_lyrics_offset(app: AppHandle, video_id: String, offset_ms: i64) -> Result<(), String> {
    lyrics::set_offset(&app, &video_id, offset_ms)
}
