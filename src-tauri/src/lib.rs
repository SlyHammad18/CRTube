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
/// window is code-created.
///
/// NOTE: video rendering is governed by the `WEBKIT_DISABLE_DMABUF_RENDERER`
/// env var forced in `main.rs` — on Wayland, WebKitGTK's DMABUF path paints a
/// black video surface (audio still plays), so the legacy/CPU GL path is
/// forced. There is no in-app toggle for this.
///
/// In `tauri dev` a code-created window must point at the dev server
/// (`app.dev_url`); `WebviewUrl::App` would otherwise load the built
/// `frontendDist` bundle and silently run a stale frontend. Release builds use
/// the bundled `App("index.html")`.
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
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
    let builder = WebviewWindowBuilder::new(app, "main", url)
        .title("CRTUBE")
        .inner_size(1240.0, 760.0)
        .min_inner_size(1000.0, 600.0)
        .resizable(true)
        .decorations(false)
        .center()
        .transparent(false)
        .background_color(Color(7, 9, 12, 255))
        .initialization_script(
            "(function(){\
               var isEditable=function(el){\
                 if(!el)return false;\
                 var t=el.tagName;\
                 return t==='INPUT'||t==='TEXTAREA'||el.isContentEditable;\
               };\
               var block=function(e){e.preventDefault();e.stopPropagation();};\
               var blockIfNoFocus=function(e){\
                 if(!isEditable(document.activeElement))block(e);\
               };\
               document.addEventListener('copy',blockIfNoFocus,true);\
               document.addEventListener('cut',blockIfNoFocus,true);\
               document.addEventListener('paste',blockIfNoFocus,true);\
               document.addEventListener('selectstart',blockIfNoFocus,true);\
               document.addEventListener('contextmenu',function(e){e.preventDefault();},true);\
               document.addEventListener('keydown',function(e){\
                 var k=e.key,m=e.metaKey,c=e.ctrlKey,s=e.shiftKey,a=e.altKey;\
                 if(k==='F5')return block(e);\
                 if(k==='F12')return block(e);\
                 if(c&&s&&(k==='I'||k==='i'||k==='J'||k==='j'||k==='C'||k==='c'))return block(e);\
                 if((c||m)&&k==='u')return block(e);\
                 if((c||m)&&!s&&!a&&(k==='a'||k==='c'||k==='x'||k==='v')){\
                   if(!isEditable(document.activeElement))return block(e);\
                   return;\
                 }\
               },true);\
               var _wt=navigator.clipboard.writeText;\
               navigator.clipboard.writeText=function(){return Promise.resolve();};\
               var _w=navigator.clipboard.write;\
               if(_w)navigator.clipboard.write=function(){return Promise.resolve();};\
               var _ec=document.execCommand.bind(document);\
               document.execCommand=function(cmd){\
                 if(cmd==='copy'||cmd==='cut'){\
                   if(!isEditable(document.activeElement))return false;\
                 }\
                 return _ec.apply(null,arguments);\
               };\
             })();",
        );
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
            // Window is created here (not tauri.conf.json).
            create_main_window(app.handle())
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
            commands::library::set_favourite,
            commands::library::rename_entry,
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
            commands::player::list_playlist_memberships,
            commands::player::reorder_playlist_items,
            commands::player::fetch_lyrics,
            commands::player::search_lyrics,
            commands::player::set_lyrics,
            commands::player::clear_lyrics,
            commands::player::set_lyrics_offset,
            commands::player::media_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running CRTube");
}
