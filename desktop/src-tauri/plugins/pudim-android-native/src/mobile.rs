//! Mobile (Android) initialization. Registers the Kotlin `PudimNativePlugin` class
//! so the webview commands can reach it via a [`PluginHandle`].

use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::commands::CaptureHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.pudimnative";

/// Binds the Android `PudimNativePlugin` (Kotlin) to this plugin instance.
pub fn init<R: Runtime>(
    _app: &AppHandle<R>,
    api: PluginApi<R, ()>,
) -> tauri::Result<CaptureHandle<R>> {
    #[cfg(target_os = "android")]
    {
        let handle: PluginHandle<R> =
            api.register_android_plugin(PLUGIN_IDENTIFIER, "PudimNativePlugin")?;
        Ok(CaptureHandle::with_plugin(handle))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = api;
        Ok(CaptureHandle::none())
    }
}
