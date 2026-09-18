//! Native Tauri commands and plugins for the desktop and Android clients.

mod auth_store;
mod oauth_loopback;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(pudim_android_native::init())
        .invoke_handler(tauri::generate_handler![
            auth_store::auth_store_get,
            auth_store::auth_store_set,
            auth_store::auth_store_delete,
            oauth_loopback::oauth_loopback_start,
            oauth_loopback::oauth_loopback_wait,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
