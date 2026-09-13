//! PudimFinance Android notification capture plugin.
//!
//! Bridges the webview and the native Android `NotificationListenerService`
//! (which observes other apps' bank notifications once the user grants
//! "Notification access"). On non-Android targets every command degrades to a
//! no-op / `false`, so the shared UI shows the "Android only" notice.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod commands;

#[cfg(mobile)]
mod mobile;

pub use commands::{CaptureHandle, CapturedNotification};

#[cfg(mobile)]
pub use commands::{mobile_secure_delete, mobile_secure_get, mobile_secure_set};

/// Registers the `pudim-native` plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pudim-native")
        .invoke_handler(tauri::generate_handler![
            commands::is_supported,
            commands::access_granted,
            commands::open_settings,
            commands::drain_pending,
            commands::biometric_available,
            commands::biometric_authenticate,
            commands::set_widget_spent_today,
            commands::take_deep_link,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let handle = mobile::init(app, api)?;
            #[cfg(not(mobile))]
            let handle = {
                let _ = api;
                commands::CaptureHandle::<R>::none()
            };
            app.manage(handle);
            Ok(())
        })
        .build()
}
