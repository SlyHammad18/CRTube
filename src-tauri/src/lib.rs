mod commands;
pub mod jobs;
pub mod services;

use std::sync::Arc;
use std::sync::Mutex;

use commands::tools::ToolService;
use jobs::JobRegistry;
use services::db::Db;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ToolService::default())
        .manage(Arc::new(JobRegistry::default()))
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?;
            let conn = services::db::open(&dir.join("library.db")).map_err(|e| e.to_string())?;
            app.manage(Arc::new(Db(Mutex::new(conn))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tools::ensure_tools,
            commands::tools::tool_versions,
            commands::tools::update_ytdlp,
            commands::search::search_youtube,
            commands::search::fetch_info,
            commands::download::start_download,
            commands::download::cancel_download,
            commands::library::add_entry,
            commands::library::list_library,
            commands::library::has_download,
            commands::library::delete_entry,
            commands::library::reveal_path,
            commands::library::open_path,
            commands::library::pick_folder,
            commands::settings::get_settings,
            commands::settings::set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running CRTube");
}
