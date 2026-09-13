package app.tauri.pudimnative

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Durable queue of import choices tapped on a capture-prompt notification while
 * no webview was alive. Drained by the `drainCaptureActions` plugin command on
 * the next app launch.
 *
 * The whole action payload is stored (not just the id) so an action can still
 * be applied if the matching inbox entry hasn't been materialized yet.
 *
 * Bounded to [MAX_ITEMS]; only the latest choice per capture id is kept.
 */
internal object PendingCaptureActions {
    private const val PREFS_NAME = "pudim_capture_actions"
    private const val KEY_ITEMS = "items"
    private const val KEY_CAPTURE_ID = "capture_id"
    private const val MAX_ITEMS = 100

    fun enqueue(context: Context, payload: Map<String, Any?>) {
        val captureId = payload[KEY_CAPTURE_ID] as? String ?: return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val items = read(prefs).toMutableList()
        items.removeAll { it.optString(KEY_CAPTURE_ID) == captureId }
        while (items.size >= MAX_ITEMS) items.removeAt(0)
        items.add(
            JSONObject().apply {
                payload.forEach { (key, value) -> put(key, value) }
            },
        )
        // commit() so the choice survives if the freshly-restarted process dies.
        prefs.edit().putString(KEY_ITEMS, JSONArray(items).toString()).commit()
    }

    /** Returns and clears every queued action. */
    fun drain(context: Context): List<Map<String, Any?>> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val items = read(prefs)
        prefs.edit().remove(KEY_ITEMS).apply()
        return items.map { item ->
            item.keys().asSequence().associateWith { key -> item.opt(key) }
        }
    }

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
