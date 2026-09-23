use std::sync::Arc;

use rusqlite::params;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::commands::player::COVER_EXTS;
use crate::services::db::{self, Db, DownloadRecord, LibraryEntry};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEntry {
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_s: Option<u64>,
    pub kind: String,
    pub quality: Option<String>,
    pub container: String,
    pub path: String,
    pub size_bytes: Option<u64>,
    pub thumb_url: Option<String>,
}

impl From<NewEntry> for DownloadRecord {
    fn from(e: NewEntry) -> Self {
        Self {
            video_id: e.video_id,
            url: e.url,
            title: e.title,
            channel: e.channel,
            duration_s: e.duration_s,
            kind: e.kind,
            quality: e.quality,
            container: e.container,
            path: e.path,
            size_bytes: e.size_bytes,
            thumb_url: e.thumb_url,
        }
    }
}

#[tauri::command]
pub fn add_entry(
    db: State<'_, Arc<Db>>,
    entry: NewEntry,
) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::insert_download(&conn, &entry.into()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_library(db: State<'_, Arc<Db>>) -> Result<Vec<LibraryEntry>, String> {
    let db = Arc::clone(&db);
    // Query the rows (lock held briefly), then run parallel existence checks
    // off the DB lock, then batch-update missing/done statuses.
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<LibraryEntry>, String> {
        let rows: Vec<LibraryEntry> = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            db::list_entries(&conn).map_err(|e| e.to_string())?
        };

        // Fast non-blocking stat checks in parallel.
        let exists: Vec<bool> = std::thread::scope(|s| {
            let handles: Vec<_> = rows
                .iter()
                .map(|e| {
                    let path = e.path.clone();
                    s.spawn(move || path.is_empty() || std::path::Path::new(&path).exists())
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        // Update statuses as a single batch.
        let mut entries = rows;
        let mut flush: Vec<(i64, &'static str)> = Vec::new();
        for (entry, &is_present) in entries.iter_mut().zip(exists.iter()) {
            if entry.path.is_empty() {
                continue;
            }
            if entry.status == "done" && !is_present {
                entry.status = "missing".to_string();
                flush.push((entry.id, "missing"));
            } else if entry.status == "missing" && is_present {
                entry.status = "done".to_string();
                flush.push((entry.id, "done"));
            }
        }
        if !flush.is_empty() {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| e.to_string())?;
            {
                let mut stmt = tx
                    .prepare("UPDATE downloads SET status = ?2 WHERE id = ?1")
                    .map_err(|e| e.to_string())?;
                for (id, status) in &flush {
                    stmt.execute(params![id, status]).map_err(|e| e.to_string())?;
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
        }

        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_favourite(
    db: State<'_, Arc<Db>>,
    id: i64,
    favourite: bool,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::set_favourite(&conn, id, favourite).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_entry(
    db: State<'_, Arc<Db>>,
    id: i64,
    title: String,
    artists: Vec<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::rename_entry(&conn, id, title.trim(), &artists).map_err(|e| e.to_string())
}

/// Pick app-only artwork for a track. The selected image is copied into
/// `{app_data}/covers/` and the original downloaded/cached thumbnail is kept in
/// `downloads.thumb_url`. Cancelling the native picker is a successful no-op.
#[tauri::command]
pub async fn pick_track_thumbnail(
    app: AppHandle,
    db: State<'_, Arc<Db>>,
    id: i64,
) -> Result<Option<LibraryEntry>, String> {
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        db::get_entry(&conn, id).map_err(|_| "track no longer exists".to_string())?;
    }

    let picker_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker_app
            .dialog()
            .file()
            .add_filter("Images", &COVER_EXTS)
            .blocking_pick_file()
            .and_then(|file| file.into_path().ok())
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };

    if !picked.is_file() {
        return Err("selected image does not exist".into());
    }
    let ext = picked
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !COVER_EXTS.contains(&ext.as_str()) {
        return Err("unsupported image type — use JPG, PNG or WebP".into());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("covers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let prefix = format!("track-{id}.");
    let dest = dir.join(format!("{prefix}{stamp}.{ext}"));
    let tmp = dir.join(format!(".{prefix}{stamp}.{ext}.tmp"));
    if let Err(error) = std::fs::copy(&picked, &tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("copy failed: {error}"));
    }
    if let Err(error) = std::fs::rename(&tmp, &dest) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("commit failed: {error}"));
    }

    let updated = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        (|| {
            db::set_custom_thumbnail(&conn, id, Some(&dest.to_string_lossy()))?;
            db::get_entry(&conn, id)
        })()
    };
    match updated {
        Ok(entry) => {
            // Keep the freshly committed file and remove every older revision.
            db::remove_cover_files(&dir, &prefix, Some(&dest));
            Ok(Some(entry))
        }
        Err(error) => {
            let _ = std::fs::remove_file(&dest);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub fn has_download(db: State<'_, Arc<Db>>, video_id: String) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::has_download(&conn, video_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_entry(
    app: AppHandle,
    db: State<'_, Arc<Db>>,
    id: i64,
    path: String,
) -> Result<(), String> {
    let custom_thumb_path: Option<String> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT custom_thumb_path FROM downloads WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .ok()
        .flatten()
    };

    if !path.trim().is_empty() {
        match tokio::fs::remove_file(path.trim()).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        db::delete_download(&conn, id).map_err(|e| e.to_string())?;
    }

    if let Some(custom) = custom_thumb_path.filter(|path| !path.trim().is_empty()) {
        let _ = std::fs::remove_file(&custom);
        if let Ok(dir) = app.path().app_data_dir() {
            let covers = dir.join("covers");
            db::remove_cover_files(&covers, &format!("track-{id}."), None);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    let path = path.trim().to_string();
    #[cfg(target_os = "linux")]
    {
        // Force Nautilus instead of the system default (e.g. Thunar).
        if let Ok(status) = std::process::Command::new("nautilus")
            .arg("--select")
            .arg(&path)
            .status()
        {
            if status.success() {
                return Ok(());
            }
        }
        // Fall through to the default opener if Nautilus is unavailable.
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path.trim(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().blocking_pick_folder();
        Ok::<Option<String>, String>(picked.and_then(|p| p.into_path().ok()).map(|p| {
            p.to_string_lossy().to_string()
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
