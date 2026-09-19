package app.tauri.pudimnative

import android.util.Log
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/**
 * Bounded in-memory log buffer for the in-app diagnostics screen.
 *
 * An Android app cannot read its own logcat, so the native decisions (capture
 * prompt actions, closed-app imports, the sync worker) are mirrored here and
 * read back by the webview through the `peekLogs` command. Records are still
 * written to logcat so `adb logcat` keeps working.
 */
internal object PudimNativeLogs {
    private const val MAX_ENTRIES = 300

    private val nextId = AtomicLong(1)
    private val entries = ArrayDeque<JSONObject>()
    private val lock = Any()

    /** Appends one entry. */
    fun record(level: String, tag: String, message: String) {
        val entry = JSONObject().apply {
            put("id", nextId.getAndIncrement())
            put("at", System.currentTimeMillis())
            put("level", level)
            put("tag", tag)
            put("message", message)
        }
        synchronized(lock) {
            entries.addLast(entry)
            while (entries.size > MAX_ENTRIES) entries.removeFirst()
        }
        when (level) {
            "error" -> Log.e(tag, message)
            "warn" -> Log.w(tag, message)
            else -> Log.i(tag, message)
        }
    }

    fun info(tag: String, message: String) = record("info", tag, message)

    fun warn(tag: String, message: String) = record("warn", tag, message)

    fun error(tag: String, message: String) = record("error", tag, message)

    /**
     * Entries newer than [sinceId]. The buffer is kept (bounded), so the caller
     * pages by remembering the highest id it has seen.
     */
    fun peek(sinceId: Long): List<Map<String, Any?>> = synchronized(lock) {
        entries
            .filter { it.optLong("id") > sinceId }
            // Plain maps: Jackson cannot serialize org.json.JSONObject fields.
            .map { entry ->
                mapOf(
                    "id" to entry.optLong("id"),
                    "at" to entry.optLong("at"),
                    "level" to entry.optString("level"),
                    "tag" to entry.optString("tag"),
                    "message" to entry.optString("message"),
                )
            }
    }

    /** Empties the buffer (the diagnostics screen's clear action). */
    fun clear() = synchronized(lock) { entries.clear() }
}
