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
    /// Resolved user-visible app label (e.g. "Nubank"); falls back to the package.
    #[serde(default)]
    pub app_label: Option<String>,
    /// Id assigned by the listener when it was captured while the app was dead.
    #[serde(default)]
    pub capture_id: Option<String>,
    /// Whether the listener already posted an import prompt for it.
    #[serde(default)]
    pub prompted: bool,
}

/// A choice made on an import-prompt notification action button.
///
/// `action` is `income`, `debit`, or `credit`; `capture_id` links back to the
/// [`CapturedNotification`] (and its pending-review inbox entry) it belongs to.
/// The raw notification fields are only present when the listener posted the
/// prompt (app was dead), so the choice stays importable on the next launch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CaptureAction {
    /// Id of the pending capture the notification was posted for.
    pub capture_id: String,
    /// `income`, `debit`, or `credit`.
    pub action: String,
    /// Android application id of the source app, when known.
    #[serde(default)]
    pub app_name: Option<String>,
    /// User-visible source app label, when known.
    #[serde(default)]
    pub app_label: Option<String>,
    /// Raw notification title, when known.
    #[serde(default)]
    pub title: Option<String>,
    /// Raw notification body, when known.
    #[serde(default)]
    pub text: Option<String>,
    /// Posting timestamp (epoch millis), when known.
    #[serde(default)]
    pub post_time: Option<i64>,
}

/// Envelope for nullable string results coming back from the Kotlin plugin.
///
/// `Invoke.resolveObject` cannot serialize a bare JSON `null`, so nullable
/// strings are nested under a `value` key and unwrapped here.
#[cfg(mobile)]
#[derive(Debug, Deserialize)]
struct NullableStringResult {
    value: Option<String>,
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

/// Posts an Android notification asking how to import a captured transaction.
///
/// The notification carries three action buttons (income/debit/credit) plus a
/// content intent that opens the app on the pending-review screen. Tapping an
/// action is delivered back through [`drain_capture_actions`] and the
/// `captureAction` plugin event.
#[tauri::command]
pub fn show_capture_prompt<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    title: String,
    body: String,
    app_label: String,
) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>(
                "showCapturePrompt",
                serde_json::json!({
                    "id": id,
                    "title": title,
                    "body": body,
                    "appLabel": app_label,
                }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (&state, &id, &title, &body, &app_label);
        Ok(())
    }
}

/// Dismisses a previously posted import-prompt notification (Android).
#[tauri::command]
pub fn cancel_capture_prompt<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>("cancelCapturePrompt", serde_json::json!({ "id": id }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (&state, &id);
        Ok(())
    }
}

/// Returns (and clears) prompt actions tapped while the webview was asleep.
#[tauri::command]
pub fn drain_capture_actions<R: Runtime>(app: AppHandle<R>) -> Result<Vec<CaptureAction>, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(Vec::new());
        };
        handle
            .run_mobile_plugin::<Vec<CaptureAction>>("drainCaptureActions", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(Vec::new())
    }
}

/// Whether Android allows PudimFinance to post notifications (Android 13+ opt-in).
#[tauri::command]
pub fn notification_posting_allowed<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(false);
        };
        handle
            .run_mobile_plugin::<bool>("notificationPostingAllowed", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(false)
    }
}

/// Shows the Android 13+ `POST_NOTIFICATIONS` runtime prompt if still needed.
#[tauri::command]
pub fn request_notification_permission<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(false);
        };
        handle
            .run_mobile_plugin::<bool>("requestNotificationPermission", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(false)
    }
}

/// Mirrors the webview's capture settings to the Android listener, so it can
/// keep prompting for detected transactions while the app process is dead.
#[tauri::command]
pub fn set_capture_settings<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
    push_prompt: bool,
    monitored_apps: Vec<String>,
) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>(
                "setCaptureSettings",
                serde_json::json!({
                    "enabled": enabled,
                    "pushPrompt": push_prompt,
                    "monitoredApps": monitored_apps,
                }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (&state, enabled, push_prompt, &monitored_apps);
        Ok(())
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
            .run_mobile_plugin::<NullableStringResult>(
                "secureGet",
                serde_json::json!({ "key": key }),
            )
            .map(|result| result.value)
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
            .run_mobile_plugin::<NullableStringResult>("takeDeepLink", ())
            .map(|result| result.value)
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
