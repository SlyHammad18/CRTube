mod commands;
mod services;

use commands::tools::ToolService;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ToolService::default())
        .invoke_handler(tauri::generate_handler![
            commands::tools::ensure_tools,
            commands::tools::tool_versions,
            commands::tools::update_ytdlp
        ])
        .run(tauri::generate_context!())
        .expect("error while running CRTube");
}
