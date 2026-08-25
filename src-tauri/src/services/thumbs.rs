use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub fn thumbs_dir(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("thumbs"))
}

pub async fn cache_thumbnail(app: &AppHandle, video_id: &str, url: &str) -> Option<PathBuf> {
    let dir = thumbs_dir(app)?;
    tokio::fs::create_dir_all(&dir).await.ok()?;
    let dest = dir.join(format!("{video_id}.jpg"));
    if dest.exists() {
        return Some(dest);
    }

    let bytes = reqwest::get(url)
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .await
        .ok()?;

    let tmp = dir.join(format!(".{video_id}.tmp"));
    tokio::fs::write(&tmp, &bytes).await.ok()?;
    tokio::fs::rename(&tmp, &dest).await.ok()?;
    Some(dest)
}
