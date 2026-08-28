use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

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
pub fn list_library(db: State<'_, Arc<Db>>) -> Result<Vec<LibraryEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_and_sync_statuses(&conn).map_err(|e| e.to_string())
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
pub fn has_download(db: State<'_, Arc<Db>>, video_id: String) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::has_download(&conn, video_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_entry(
    db: State<'_, Arc<Db>>,
    id: i64,
    path: String,
) -> Result<(), String> {
    if !path.trim().is_empty() {
        match tokio::fs::remove_file(path.trim()).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::delete_download(&conn, id).map_err(|e| e.to_string())
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
