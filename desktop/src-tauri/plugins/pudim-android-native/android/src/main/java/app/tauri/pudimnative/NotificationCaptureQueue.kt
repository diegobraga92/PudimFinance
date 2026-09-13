package app.tauri.pudimnative

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Durable queue of raw notifications captured while the app process was dead
 * (no webview alive to receive them). The native
 * [NotificationListenerService] writes here when [PudimNativePlugin.instance] is
 * null, and the webview drains the queue on the next app launch.
 *
 * Bounded to [MAX_ITEMS] so unrelated apps can't grow it without limit.
 */
internal object NotificationCaptureQueue {
    private const val PREFS_NAME = "pudim_notification_queue"
    private const val KEY_ITEMS = "items"
    private const val KEY_DEDUP = "_dedupKey"
    private const val MAX_ITEMS = 200

    fun enqueue(context: Context, payload: Map<String, Any?>) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val items = read(prefs).toMutableList()
        // Drop any existing entry for the same posting so a re-delivered
        // notification isn't processed twice.
        val dedupKey = dedupKeyOf(payload)
        items.removeAll { it.optString(KEY_DEDUP) == dedupKey }
        while (items.size >= MAX_ITEMS) items.removeAt(0)
        items.add(JSONObject(payload).put(KEY_DEDUP, dedupKey))
        // commit() (not apply()) so the write is durable even if the OS kills
        // this freshly-restarted process right after delivering the notification.
        prefs.edit().putString(KEY_ITEMS, JSONArray(items).toString()).commit()
    }

    /** Returns and clears all persisted notifications. */
    fun drain(context: Context): List<Map<String, Any?>> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val items = read(prefs)
        prefs.edit().remove(KEY_ITEMS).apply()
        // Generic mapping so optional fields (capture_id, prompted) survive;
        // internal bookkeeping keys (prefixed with "_") are dropped.
        return items.map { item ->
            item.keys().asSequence()
                .filterNot { it.startsWith("_") }
                .associateWith { key -> item.opt(key) }
        }
    }

    private fun dedupKeyOf(payload: Map<String, Any?>): String =
        "${payload["post_time"]}|${payload["app_name"]}|${payload["title"]}"

    private fun read(prefs: SharedPreferences): MutableList<JSONObject> {
        val raw = prefs.getString(KEY_ITEMS, null) ?: return mutableListOf()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapTo(mutableListOf()) { arr.getJSONObject(it) }
        } catch (_: Exception) {
            mutableListOf()
        }
    }
}
