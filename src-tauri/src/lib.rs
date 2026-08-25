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
            // §5.6 — make the download dir playable over the asset protocol.
            commands::settings::allow_media_scope(app.handle(), &commands::settings::load_settings(app.handle()));
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
            commands::settings::set_settings,
            commands::player::list_playlists,
            commands::player::create_playlist,
            commands::player::rename_playlist,
            commands::player::delete_playlist,
            commands::player::add_playlist_item,
            commands::player::remove_playlist_item,
            commands::player::list_playlist_items,
            commands::player::reorder_playlist_items,
            commands::player::fetch_lyrics
        ])
        .run(tauri::generate_context!())
        .expect("error while running CRTube");
}
