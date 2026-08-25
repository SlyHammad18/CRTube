mod commands;
pub mod jobs;
pub mod services;

use std::sync::Arc;

use commands::tools::ToolService;
use jobs::JobRegistry;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ToolService::default())
        .manage(Arc::new(JobRegistry::default()))
        .invoke_handler(tauri::generate_handler![
            commands::tools::ensure_tools,
            commands::tools::tool_versions,
            commands::tools::update_ytdlp,
            commands::search::search_youtube,
            commands::search::fetch_info,
            commands::download::start_download,
            commands::download::cancel_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running CRTube");
}
