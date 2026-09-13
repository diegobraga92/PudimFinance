//! Commands exposed to the webview as `plugin:pudim-native|…`.
//!
//! On Android they forward to the Kotlin `PudimNativePlugin` via the stored
//! [`PluginHandle`]. Everywhere else they return desktop-safe defaults so the
//! shared UI can render the "Android only" messaging.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// A bank notification captured by the Android `NotificationListenerService`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CapturedNotification {
    /// Android application id of the app that posted the notification.
    pub app_name: String,
    /// Notification title (usually the bank/app name).
    pub title: String,
    /// Notification body (big text/text/lines joined).
    pub text: String,
    /// Posting timestamp (epoch millis).
    pub post_time: i64,
}

/// Handle to the native Android plugin, stored in app state during setup.
/// On non-mobile targets this is empty and every command degrades to a default.
pub struct CaptureHandle<R: Runtime> {
    #[cfg(mobile)]
    plugin: Option<PluginHandle<R>>,
    #[cfg(not(mobile))]
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> CaptureHandle<R> {
    /// Creates an empty handle (used on non-mobile targets).
    pub fn none() -> Self {
        Self {
            #[cfg(mobile)]
            plugin: None,
            #[cfg(not(mobile))]
            marker: std::marker::PhantomData,
        }
    }

    /// Wraps a registered Android plugin handle (mobile targets only).
    #[cfg(mobile)]
    pub fn with_plugin(plugin: PluginHandle<R>) -> Self {
        Self {
            plugin: Some(plugin),
        }
    }

    /// The registered Android plugin handle, when available.
    #[cfg(mobile)]
    pub fn plugin(&self) -> Option<&PluginHandle<R>> {
        self.plugin.as_ref()
    }
}

#[tauri::command]
pub fn is_supported() -> bool {
    cfg!(target_os = "android")
}

#[tauri::command]
pub fn access_granted<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(false);
        };
        handle
            .run_mobile_plugin::<bool>("accessGranted", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(false)
    }
}

#[tauri::command]
pub fn open_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>("openSettings", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(())
    }
}

#[tauri::command]
pub fn drain_pending<R: Runtime>(app: AppHandle<R>) -> Result<Vec<CapturedNotification>, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(Vec::new());
        };
        handle
            .run_mobile_plugin::<Vec<CapturedNotification>>("drainPending", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(Vec::new())
    }
}

// Keystore-backed token storage (Android). The `keyring` crate has no reliable
// Android backend, so these forward to the Kotlin `SecureStorage` (Android
// Keystore and AES/GCM). On desktop the app's auth_store commands use keyring.

#[tauri::command]
pub fn secure_get<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(None);
        };
        handle
            .run_mobile_plugin::<Option<String>>("secureGet", serde_json::json!({ "key": key }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        let _ = &key;
        Ok(None)
    }
}

#[tauri::command]
pub fn secure_set<R: Runtime>(app: AppHandle<R>, key: String, value: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>(
                "secureSet",
                serde_json::json!({ "key": key, "value": value }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        let _ = (&key, &value);
        Ok(())
    }
}

#[tauri::command]
pub fn secure_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>("secureDelete", serde_json::json!({ "key": key }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        let _ = &key;
        Ok(())
    }
}

// Biometric lock and home-screen Quick Add widget (Android). On desktop these
// commands degrade to defaults so the shared UI never hard-fails.
#[tauri::command]
pub fn biometric_available<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(false);
        };
        handle
            .run_mobile_plugin::<bool>("biometricAvailable", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(false)
    }
}

#[tauri::command]
pub fn biometric_authenticate<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(false);
        };
        handle
            .run_mobile_plugin::<bool>("biometricAuthenticate", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(false)
    }
}

#[tauri::command]
pub fn set_widget_spent_today<R: Runtime>(app: AppHandle<R>, value: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>("setWidgetSpentToday", serde_json::json!({ "value": value }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        let _ = &value;
        Ok(())
    }
}

#[tauri::command]
pub fn take_deep_link<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(None);
        };
        handle
            .run_mobile_plugin::<Option<String>>("takeDeepLink", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(None)
    }
}
#[cfg(mobile)]
pub fn mobile_secure_get<R: Runtime>(
    app: &AppHandle<R>,
    key: String,
) -> Result<Option<String>, String> {
    secure_get(app.clone(), key)
}

#[cfg(mobile)]
pub fn mobile_secure_set<R: Runtime>(
    app: &AppHandle<R>,
    key: String,
    value: String,
) -> Result<(), String> {
    secure_set(app.clone(), key, value)
}

#[cfg(mobile)]
pub fn mobile_secure_delete<R: Runtime>(app: &AppHandle<R>, key: String) -> Result<(), String> {
    secure_delete(app.clone(), key)
}
