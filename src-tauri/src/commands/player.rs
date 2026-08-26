use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::services::db::{self, Db, Playlist, PlaylistTrack};
use crate::services::installer;
use crate::services::lyrics::{self, LyricsPayload};
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
pub fn media_url(
    app: AppHandle,
    server: State<'_, media::MediaServer>,
    db: State<'_, Arc<Db>>,
    id: i64,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT path, kind FROM downloads WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let (path, kind) = match row
        .filter(|(p, _)| !p.trim().is_empty() && Path::new(p.trim()).is_file())
    {
        Some((p, k)) => (p, k),
        None => return Ok(None),
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
        match media::probe_video_codec(path_ref, &ffprobe) {
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
