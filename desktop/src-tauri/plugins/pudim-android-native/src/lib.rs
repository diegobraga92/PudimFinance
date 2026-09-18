//! Android notification capture and native client capabilities.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub mod commands;

#[cfg(mobile)]
mod mobile;

pub use commands::{CaptureAction, CaptureHandle, CapturedNotification};

#[cfg(mobile)]
pub use commands::{mobile_secure_delete, mobile_secure_get, mobile_secure_set};

/// Registers the `pudim-native` plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pudim-native")
        .invoke_handler(tauri::generate_handler![
            commands::is_supported,
            commands::access_granted,
            commands::open_settings,
            commands::open_external,
            commands::google_sign_in,
            commands::drain_pending,
            commands::show_capture_prompt,
            commands::cancel_capture_prompt,
            commands::drain_capture_actions,
            commands::notification_posting_allowed,
            commands::request_notification_permission,
            commands::set_capture_settings,
            commands::set_sync_config,
            commands::sync_outbox_put,
            commands::sync_outbox_remove,
            commands::drain_sync_results,
            commands::clear_sync_outbox,
            commands::biometric_available,
            commands::biometric_authenticate,
            commands::set_widget_spending,
            commands::set_widget_theme,
            commands::take_deep_link,
            commands::take_auth_redirect,
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
