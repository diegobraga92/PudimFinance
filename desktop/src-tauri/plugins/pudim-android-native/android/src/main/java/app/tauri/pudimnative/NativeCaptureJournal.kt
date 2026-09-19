package app.tauri.pudimnative

import android.content.Context
import org.json.JSONArray

/** A capture that was already imported natively while the app was closed. */
internal data class NativeCaptureImport(
    /** Encrypted sync-outbox client id used for this capture. */
    val clientId: String,
    /** Transaction fields that were enqueued. */
    val plan: CaptureImportPlan,
)

/**
 * Encrypted bounded journal preventing native closed-app captures from being
 * imported twice, for example when Android re-delivers a notification (or a
 * prompt action) after the listener reconnects.
 */
internal object NativeCaptureJournal {
    private const val KEY = "pudim_native_capture_imports"
    private const val MAX_ITEMS = 300

    @Synchronized
    fun contains(context: Context, captureId: String): Boolean = read(context).contains(captureId)

    @Synchronized
    fun add(context: Context, captureId: String) {
        val values = read(context).filter { it != captureId }.toMutableList()
        values.add(captureId)
        SecureStorage.set(context, KEY, JSONArray(values.takeLast(MAX_ITEMS)).toString())
    }

    private fun read(context: Context): List<String> {
        val raw = SecureStorage.get(context, KEY) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
