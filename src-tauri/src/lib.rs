mod commands;
mod curl;
mod error;
mod file_transfer;
mod http;
mod models;
mod postman;
mod secrets;
mod storage;

use tauri::Manager;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    builder
        .setup(|app| {
            let paths = storage::initialize(&app.handle())?;
            app.manage(AppState { paths });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_bootstrap_state,
            commands::record_history_entry,
            commands::save_secret,
            commands::save_environment,
            commands::save_request,
            commands::import_curl,
            commands::export_curl,
            commands::import_postman_collection,
            commands::upload_file,
            commands::download_file,
            commands::send_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
