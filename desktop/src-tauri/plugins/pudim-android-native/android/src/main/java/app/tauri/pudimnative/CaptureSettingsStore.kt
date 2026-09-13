package app.tauri.pudimnative

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

/**
 * Native mirror of the webview's notification-capture settings.
 *
 * The webview pushes a snapshot whenever settings change (`setCaptureSettings`)
 * so [NotificationListenerService] can honor them while the app process is
 * dead — in particular to decide whether to post an import prompt right away
 * instead of waiting for the next launch.
 */
internal object CaptureSettingsStore {
    private const val PREFS_NAME = "pudim_capture_settings"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_PUSH_PROMPT = "push_prompt"
    private const val KEY_MONITORED_APPS = "monitored_apps"

    data class Snapshot(
        val enabled: Boolean,
        val pushPrompt: Boolean,
        /** Human-readable app labels ("Nubank"); empty means "all apps". */
        val monitoredApps: List<String>,
    )

    fun save(context: Context, enabled: Boolean, pushPrompt: Boolean, monitoredApps: List<String>) {
        prefs(context).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putBoolean(KEY_PUSH_PROMPT, pushPrompt)
            .putString(KEY_MONITORED_APPS, JSONArray(monitoredApps).toString())
            .apply()
    }

    fun read(context: Context): Snapshot {
        val prefs = prefs(context)
        return Snapshot(
            enabled = prefs.getBoolean(KEY_ENABLED, false),
            pushPrompt = prefs.getBoolean(KEY_PUSH_PROMPT, true),
            monitoredApps = readApps(prefs),
        )
    }

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun readApps(prefs: SharedPreferences): List<String> {
        val raw = prefs.getString(KEY_MONITORED_APPS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
