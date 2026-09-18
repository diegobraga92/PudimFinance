//! Platform-secure session token storage.

use tauri::{AppHandle, Runtime};

#[cfg(not(mobile))]
use keyring::Entry;

/// Namespaced under the app identifier so credentials don't collide with other
/// software in the same Secret Service collection.
#[cfg(not(mobile))]
const KEYRING_SERVICE: &str = "com.pudimfinance.app";

/// Reads a secret. Returns `Ok(None)` when no entry exists.
#[tauri::command]
pub fn auth_store_get<R: Runtime>(
    app: AppHandle<R>,
    key: String,
) -> Result<Option<String>, String> {
    #[cfg(mobile)]
    {
        pudim_android_native::mobile_secure_get(&app, key)
    }
    #[cfg(not(mobile))]
    {
        let _ = &app;
        let entry = Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Writes (or overwrites) a secret.
#[tauri::command]
pub fn auth_store_set<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    value: String,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        pudim_android_native::mobile_secure_set(&app, key, value)
    }
    #[cfg(not(mobile))]
    {
        let _ = &app;
        let entry = Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
        entry.set_password(&value).map_err(|e| e.to_string())
    }
}

/// Deletes a secret. Idempotent, so missing entries are fine.
#[tauri::command]
pub fn auth_store_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        pudim_android_native::mobile_secure_delete(&app, key)
    }
    #[cfg(not(mobile))]
    {
        let _ = &app;
        let entry = Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}
