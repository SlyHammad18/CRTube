use tauri::AppHandle;

use crate::services::installer;
use crate::services::ytdlp::{self, SearchItem, VideoInfo};

#[tauri::command]
pub async fn search_youtube(
    app: AppHandle,
    query: String,
    page: u32,
) -> Result<Vec<SearchItem>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let bin = installer::bin_dir(&app).map_err(|e| e.to_string())?;
    ytdlp::search_youtube(&bin, query, page).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_info(app: AppHandle, url: String) -> Result<VideoInfo, String> {
    let url = url.trim().to_string();
    let bin = installer::bin_dir(&app).map_err(|e| e.to_string())?;
    ytdlp::fetch_info(&bin, &url).await.map_err(|e| e.to_string())
}
