//! PudimFinance Rust core, shared by the desktop binary and the Android app.
//!
//! The webview (React/Vite) is the entire UI. This crate provides native
//! capabilities, namely keyring-backed token storage and the Android
//! notification capture plugin.

mod auth_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(pudim_android_native::init())
        .invoke_handler(tauri::generate_handler![
            auth_store::auth_store_get,
            auth_store::auth_store_set,
            auth_store::auth_store_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
