mod commands;
pub mod jobs;
pub mod services;

use std::sync::Arc;
use std::sync::Mutex;

use commands::tools::ToolService;
use jobs::JobRegistry;
use services::db::Db;
use tauri::Manager;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri::window::Color;

/// Build the main window. Defined here (instead of tauri.conf.json) so the
/// webview browser args can be toggled at launch from the persisted
/// `hardware_accel` setting.
///
/// NOTE: on Wayland, WebKitGTK's hardware/DMABUF path paints a black video
/// surface (audio still plays). `main.rs` already forces the legacy/CPU path
/// via `WEBKIT_DISABLE_DMABUF_RENDERER`. So the *default* (hardware accel ON)
/// applies NO extra browser args — that is the configuration that actually
/// renders video here. Disabling hardware acceleration forces `--disable-gpu`
/// (pure software compositing), which is also a safe, never-black fallback.
///
/// In `tauri dev` a code-created window must point at the dev server
/// (`app.dev_url`); `WebviewUrl::App` would otherwise load the built
/// `frontendDist` bundle and silently run a stale frontend. Release builds use
/// the bundled `App("index.html")`.
fn create_main_window(app: &AppHandle, hw_accel: bool) -> tauri::Result<()> {
    let url = if cfg!(debug_assertions) {
        app.config()
            .build
            .dev_url
            .clone()
            .map(WebviewUrl::External)
            .unwrap_or_else(|| WebviewUrl::App("index.html".into()))
    } else {
        WebviewUrl::App("index.html".into())
    };
    let mut builder = WebviewWindowBuilder::new(app, "main", url)
        .title("CRTUBE")
        .inner_size(1240.0, 760.0)
        .min_inner_size(1000.0, 600.0)
        .resizable(true)
        .decorations(false)
        .center()
        .transparent(false)
        .background_color(Color(7, 9, 12, 255));
    if !hw_accel {
        builder = builder.additional_browser_args("--disable-gpu");
    }
    builder.build()?;
    Ok(())
}

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
            let settings =
                commands::settings::load_settings(app.handle());
            // Window is created here (not tauri.conf.json) so GPU browser args
            // can follow the persisted `hardware_accel` setting (§settings).
            create_main_window(app.handle(), settings.hardware_accel)
                .map_err(|e| e.to_string())?;
            // §5.6 — asset protocol keeps serving thumbs/bin.
            commands::settings::allow_media_scope(app.handle(), &settings);
            // §5.6 — loopback media streamer serves downloaded audio/video
            // (WebKitGTK's media pipeline cannot fetch custom schemes).
            let media_roots = vec![settings.effective_download_dir()];
            let server = tauri::async_runtime::block_on(
                services::media::MediaServer::spawn(app.handle().clone(), media_roots),
            )?;
            app.manage(server);
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
            commands::player::fetch_lyrics,
            commands::player::media_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running CRTube");
}
