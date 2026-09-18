use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::player::COVER_EXTS;
use crate::services::db::{self, Artist, CoverKind, Db};

/// All known artists with their track counts. Artwork resolves on the
/// frontend from each artist's own track thumbnails (no external image API).
#[tauri::command]
pub fn list_artists(db: State<'_, Arc<Db>>) -> Result<Vec<Artist>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_artists(&conn).map_err(|e| e.to_string())
}

/// Pick a custom cover image for an artist from a native file dialog. The file
/// is copied into `{app_data}/covers/` (Rust-side) and the artist switches to
/// `custom` cover mode. Returns the updated artist.
#[tauri::command]
pub async fn pick_artist_cover(
    app: AppHandle,
    db: State<'_, Arc<Db>>,
    artist_id: i64,
) -> Result<Artist, String> {
    let picker_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker_app
            .dialog()
            .file()
            .add_filter("Images", &COVER_EXTS)
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "no image selected".to_string())?;

    if !picked.is_file() {
        return Err("selected image does not exist".into());
    }
    let ext = picked
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !COVER_EXTS.contains(&ext.as_str()) {
        return Err("unsupported image type — use jpg, png or webp".into());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("covers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Timestamped name so re-picking always yields a fresh URL (the webview
    // caches images by path); stale files are swept below.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let prefix = format!("artist-{artist_id}.");
    let dest = dir.join(format!("{prefix}{stamp}.{ext}"));
    let tmp = dir.join(format!(".{prefix}{stamp}.{ext}.tmp"));
    std::fs::copy(&picked, &tmp).map_err(|e| format!("copy failed: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| format!("commit failed: {e}"))?;
    db::remove_cover_files(&dir, &prefix, Some(&dest));

    set_artist_cover(db, artist_id, CoverKind::Custom, Some(&dest))
}

/// Drop a custom cover and return to the auto collage mode.
#[tauri::command]
pub fn clear_artist_cover(db: State<'_, Arc<Db>>, artist_id: i64) -> Result<Artist, String> {
    let stale: Option<String> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT cover_path FROM artists WHERE id = ?1",
            [artist_id],
            |r| r.get(0),
        )
        .ok()
    };
    let artist = set_artist_cover(db, artist_id, CoverKind::Auto, None)?;
    if let Some(path) = stale {
        let path = PathBuf::from(&path);
        if let Some(dir) = path.parent() {
            db::remove_cover_files(dir, &format!("artist-{artist_id}."), Some(&path));
        }
        let _ = std::fs::remove_file(&path);
    }
    Ok(artist)
}

/// Apply a cover mode + path, spawning a fresh read of the updated artist.
fn set_artist_cover(
    db: State<'_, Arc<Db>>,
    artist_id: i64,
    kind: CoverKind,
    cover_path: Option<&Path>,
) -> Result<Artist, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path = cover_path.map(|p| p.to_string_lossy().to_string());
    db::set_artist_cover_kind(&conn, artist_id, kind, path.as_deref())
        .map_err(|e| e.to_string())?;
    db::get_artist(&conn, artist_id).map_err(|e| e.to_string())
}