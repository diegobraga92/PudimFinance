package app.tauri.pudimnative

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Durable journal of capture events the WebView has not processed yet: import
 * choices tapped on a capture-prompt notification, and transactions imported
 * natively while no WebView was alive.
 *
 * The WebView *peeks* the journal and acknowledges each entry only after it has
 * been applied, so a crash (or an entry the WebView cannot apply) leaves the tap
 * queued for the next launch instead of losing it. Acknowledgement is per
 * capture id, so a batch that fails halfway keeps its unacknowledged tail.
 *
 * The whole payload is stored (not just the id) so an event can still be
 * applied if the matching inbox entry hasn't been materialized yet. Entries
 * produced by a native import also carry the `client_id` the sync outbox
 * uploaded, so the WebView mirrors the same transaction instead of duplicating
 * it.
 *
 * Bounded to [MAX_ITEMS]; only the latest event per capture id is kept.
 */
internal object PendingCaptureActions {
    private const val PREFS_NAME = "pudim_capture_actions"
    private const val KEY_ITEMS = "items"
    private const val KEY_CAPTURE_ID = "capture_id"

    /** Same bound as [NotificationCaptureQueue], so the journal cannot grow forever. */
    internal const val MAX_ITEMS = 100

    fun enqueue(context: Context, payload: Map<String, Any?>) {
        if (payload[KEY_CAPTURE_ID] as? String == null) return
        val prefs = prefs(context)
        // commit() so the choice survives if the freshly-restarted process dies.
        prefs.edit().putString(KEY_ITEMS, addItem(prefs.getString(KEY_ITEMS, null), payload)).commit()
    }

    /** Returns every queued action without clearing it. */
    fun peek(context: Context): List<Map<String, Any?>> =
        decode(prefs(context).getString(KEY_ITEMS, null))

    /** Drops the acknowledged capture ids; returns how many entries were removed. */
    fun ack(context: Context, ids: List<String>): Int {
        if (ids.isEmpty()) return 0
        val prefs = prefs(context)
        val raw = prefs.getString(KEY_ITEMS, null) ?: return 0
        val next = removeItems(raw, ids.toSet())
        if (next == raw) return 0
        // commit() so an acknowledged tap cannot replay after a crash.
        prefs.edit().putString(KEY_ITEMS, next).commit()
        return decode(raw).size - decode(next).size
    }

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Pure merge behind [enqueue]: the latest event per capture id wins and the
     * journal never exceeds [MAX_ITEMS] entries.
     */
    internal fun addItem(raw: String?, payload: Map<String, Any?>): String {
        val items = decodeArray(raw).toMutableList()
        val captureId = payload[KEY_CAPTURE_ID] as? String
        if (captureId != null) items.removeAll { it.optString(KEY_CAPTURE_ID) == captureId }
        while (items.size >= MAX_ITEMS) items.removeAt(0)
        items.add(
            JSONObject().apply {
                payload.forEach { (key, value) -> put(key, value) }
            },
        )
        return JSONArray(items).toString()
    }

    /**
     * Pure acknowledgement behind [ack]; returns [raw] untouched when no id
     * matched, so the caller can tell a no-op from a real removal.
     */
    internal fun removeItems(raw: String, ids: Set<String>): String {
        if (ids.isEmpty()) return raw
        val items = decodeArray(raw)
        val kept = items.filterNot { it.optString(KEY_CAPTURE_ID) in ids }
        if (kept.size == items.size) return raw
        return JSONArray(kept).toString()
    }

    /** Decodes a journal blob into payloads; an unreadable blob reads as empty. */
    internal fun decode(raw: String?): List<Map<String, Any?>> =
        decodeArray(raw).map { item ->
            item.keys().asSequence().associateWith { key -> item.opt(key) }
        }

    private fun decodeArray(raw: String?): List<JSONObject> {
        if (raw.isNullOrEmpty()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
