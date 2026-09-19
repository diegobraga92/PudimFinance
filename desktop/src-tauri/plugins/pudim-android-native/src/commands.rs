//! Commands exposed to the webview through the native plugin.

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

/// A choice made on an import-prompt notification action button, or a
/// transaction the native side imported while the WebView was asleep.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CaptureAction {
    /// Id of the pending capture the notification was posted for.
    pub capture_id: String,
    /// `income`, `debit`, or `credit`. Absent on native-import journal entries.
    #[serde(default)]
    pub action: Option<String>,
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
    /// Sync-outbox client id when the native side already imported the capture.
    #[serde(default)]
    pub client_id: Option<String>,
    /// True when the entry describes a completed native import.
    #[serde(default)]
    pub native_import: bool,
    /// Parsed merchant description of a native import.
    #[serde(default)]
    pub description: Option<String>,
    /// Parsed decimal amount of a native import.
    #[serde(default)]
    pub amount: Option<String>,
    /// Parsed transaction type (`income`/`expense`) of a native import.
    #[serde(default, rename = "type")]
    pub transaction_type: Option<String>,
    /// Parsed ISO date of a native import.
    #[serde(default)]
    pub date: Option<String>,
    /// Category used by a native import.
    #[serde(default)]
    pub category_id: Option<String>,
    /// Payment account used by a native import.
    #[serde(default)]
    pub account_id: Option<String>,
    /// Notes applied by a native import.
    #[serde(default)]
    pub notes: Option<String>,
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

#[cfg(mobile)]
#[derive(Debug, Deserialize)]
struct GoogleSignInResult {
    id_token: String,
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

/// Opens a validated OAuth authorization URL in the system browser.
#[tauri::command]
pub fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    if !is_google_authorization_url(&url) {
        return Err("Only Google authorization URLs may be opened".to_string());
    }
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Err("Native Android plugin is unavailable".to_string());
        };
        handle
            .run_mobile_plugin::<()>("openExternal", serde_json::json!({ "url": url }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        #[cfg(target_os = "linux")]
        let mut command = std::process::Command::new("xdg-open");
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("open");
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = std::process::Command::new("cmd");
            command.args(["/C", "start", ""]);
            command
        };
        command
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open system browser: {e}"))
    }
}

/// Shows Android Credential Manager's Google account picker.
#[tauri::command]
pub fn google_sign_in<R: Runtime>(
    app: AppHandle<R>,
    server_client_id: String,
    nonce: String,
) -> Result<String, String> {
    if server_client_id.trim().is_empty() || nonce.trim().is_empty() {
        return Err("Google sign-in requires a server client ID and nonce".to_string());
    }
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Err("Native Android plugin is unavailable".to_string());
        };
        handle
            .run_mobile_plugin::<GoogleSignInResult>(
                "googleSignIn",
                serde_json::json!({
                    "serverClientId": server_client_id,
                    "nonce": nonce,
                }),
            )
            .map(|result| result.id_token)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (&state, server_client_id, nonce);
        Err("Google Credential Manager is only available on Android".to_string())
    }
}

fn is_google_authorization_url(url: &str) -> bool {
    url.len() <= 4096
        && url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?")
        && !url.contains('\n')
        && !url.contains('\r')
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

/// Posts an Android notification with transaction import actions.
#[tauri::command]
pub fn show_capture_prompt<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    title: String,
    body: String,
    app_label: String,
    app_name: Option<String>,
    description: Option<String>,
    amount: Option<String>,
    date: Option<String>,
    category_id: Option<String>,
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
                    // Parsed capture fields so a tap can still be imported
                    // natively when the WebView is not alive to handle it.
                    "appName": app_name,
                    "description": description,
                    "amount": amount,
                    "date": date,
                    "categoryId": category_id,
                }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (&state, &id, &title, &body, &app_label);
        let _ = (&app_name, &description, &amount, &date, &category_id);
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
#[allow(clippy::too_many_arguments)]
pub fn set_capture_settings<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
    push_prompt: bool,
    monitored_apps: Vec<String>,
    mode: String,
    default_category_id: Option<String>,
    debit_account_id: Option<String>,
    credit_account_id: Option<String>,
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
                    "mode": mode,
                    "defaultCategoryId": default_category_id,
                    "debitAccountId": debit_account_id,
                    "creditAccountId": credit_account_id,
                }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (
            &state,
            enabled,
            push_prompt,
            &monitored_apps,
            mode,
            default_category_id,
            debit_account_id,
            credit_account_id,
        );
        Ok(())
    }
}

/// Configures the API URL used by the closed-app Android sync worker.
#[tauri::command]
pub fn set_sync_config<R: Runtime>(app: AppHandle<R>, base_url: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>("setSyncConfig", serde_json::json!({ "baseUrl": base_url }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (&state, base_url);
        Ok(())
    }
}

/// Mirrors an IndexedDB mutation into the encrypted native outbox.
#[tauri::command]
pub fn sync_outbox_put<R: Runtime>(
    app: AppHandle<R>,
    operation_type: String,
    entity_type: String,
    client_id: String,
    server_id: Option<String>,
    payload_json: String,
) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>(
                "syncOutboxPut",
                serde_json::json!({
                    "operationType": operation_type,
                    "entityType": entity_type,
                    "clientId": client_id,
                    "serverId": server_id,
                    "payloadJson": payload_json,
                }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (
            &state,
            operation_type,
            entity_type,
            client_id,
            server_id,
            payload_json,
        );
        Ok(())
    }
}

/// Removes a native operation settled by the foreground sync engine.
#[tauri::command]
pub fn sync_outbox_remove<R: Runtime>(app: AppHandle<R>, client_id: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>(
                "syncOutboxRemove",
                serde_json::json!({ "clientId": client_id }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = (&state, client_id);
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NativeSyncResult {
    pub client_id: String,
    pub status: String,
    #[serde(default)]
    pub server_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Returns and clears closed-app sync results for JS/IndexedDB reconciliation.
#[tauri::command]
pub fn drain_sync_results<R: Runtime>(app: AppHandle<R>) -> Result<Vec<NativeSyncResult>, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(Vec::new());
        };
        handle
            .run_mobile_plugin::<Vec<NativeSyncResult>>("drainSyncResults", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(Vec::new())
    }
}

/// Clears the closed-app outbox and result journal after logout.
#[tauri::command]
pub fn clear_sync_outbox<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>("clearSyncOutbox", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        Ok(())
    }
}

// Android Keystore-backed token storage; desktop uses the OS keyring instead.

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

// Biometric lock and widget commands; desktop returns safe defaults.
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
pub fn set_widget_spending<R: Runtime>(app: AppHandle<R>, payload: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>(
                "setWidgetSpending",
                serde_json::json!({ "payload": payload }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        let _ = &payload;
        Ok(())
    }
}

#[tauri::command]
pub fn set_widget_theme<R: Runtime>(app: AppHandle<R>, theme: String) -> Result<(), String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(());
        };
        handle
            .run_mobile_plugin::<()>("setWidgetTheme", serde_json::json!({ "theme": theme }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = &state;
        let _ = &theme;
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

#[tauri::command]
pub fn take_auth_redirect<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let state = app.state::<CaptureHandle<R>>();
    #[cfg(mobile)]
    {
        let Some(handle) = state.plugin() else {
            return Ok(None);
        };
        handle
            .run_mobile_plugin::<NullableStringResult>("takeAuthRedirect", ())
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
