package app.tauri.pudimnative

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Encrypted native sync journal used when the WebView/IndexedDB is not alive.
 * The complete JSON blobs are encrypted by [SecureStorage] and committed before
 * WorkManager is scheduled, so a process death cannot lose a capture.
 */
internal object SyncOutbox {
    private const val OUTBOX_KEY = "pudim_native_sync_outbox"
    private const val RESULTS_KEY = "pudim_native_sync_results"
    private const val CONFIG_PREFS = "pudim_native_sync_config"
    private const val BASE_URL_KEY = "base_url"
    private const val MAX_OPERATIONS = 200
    private const val MAX_RESULTS = 200

    @Synchronized
    fun enqueue(context: Context, operation: JSONObject) {
        val items = readEncryptedArray(context, OUTBOX_KEY)
        val clientId = operation.optString("client_id")
        for (index in items.length() - 1 downTo 0) {
            if (items.optJSONObject(index)?.optString("client_id") == clientId) items.remove(index)
        }
        while (items.length() >= MAX_OPERATIONS) items.remove(0)
        items.put(operation)
        writeEncryptedArray(context, OUTBOX_KEY, items)
        SyncScheduler.enqueue(context)
    }

    @Synchronized
    fun acknowledge(context: Context, clientId: String) {
        val items = readEncryptedArray(context, OUTBOX_KEY)
        for (index in items.length() - 1 downTo 0) {
            if (items.optJSONObject(index)?.optString("client_id") == clientId) items.remove(index)
        }
        writeEncryptedArray(context, OUTBOX_KEY, items)
    }

    @Synchronized
    fun operations(context: Context): JSONArray = readEncryptedArray(context, OUTBOX_KEY)

    @Synchronized
    fun recordResult(
        context: Context,
        clientId: String,
        status: String,
        serverId: String? = null,
        error: String? = null,
    ) {
        val results = readEncryptedArray(context, RESULTS_KEY)
        while (results.length() >= MAX_RESULTS) results.remove(0)
        results.put(JSONObject().apply {
            put("client_id", clientId)
            put("status", status)
            if (serverId != null) put("server_id", serverId)
            if (error != null) put("error", error)
        })
        writeEncryptedArray(context, RESULTS_KEY, results)
    }

    @Synchronized
    fun drainResults(context: Context): List<Map<String, Any?>> {
        val results = readEncryptedArray(context, RESULTS_KEY)
        SecureStorage.delete(context, RESULTS_KEY)
        return (0 until results.length()).mapNotNull { index ->
            val result = results.optJSONObject(index) ?: return@mapNotNull null
            buildMap<String, Any?> {
                put("client_id", result.optString("client_id"))
                put("status", result.optString("status"))
                result.optString("server_id").takeIf { it.isNotBlank() }?.let { put("server_id", it) }
                result.optString("error").takeIf { it.isNotBlank() }?.let { put("error", it) }
            }
        }
    }

    fun setBaseUrl(context: Context, baseUrl: String) {
        context.getSharedPreferences(CONFIG_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(BASE_URL_KEY, baseUrl.trimEnd('/'))
            .commit()
        SyncScheduler.schedulePeriodic(context)
        if (operations(context).length() > 0) SyncScheduler.enqueue(context)
    }

    fun baseUrl(context: Context): String? = context
        .getSharedPreferences(CONFIG_PREFS, Context.MODE_PRIVATE)
        .getString(BASE_URL_KEY, null)

    @Synchronized
    fun clear(context: Context) {
        SecureStorage.delete(context, OUTBOX_KEY)
        SecureStorage.delete(context, RESULTS_KEY)
    }

    private fun readEncryptedArray(context: Context, key: String): JSONArray {
        val raw = SecureStorage.get(context, key) ?: return JSONArray()
        return try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
    }

    private fun writeEncryptedArray(context: Context, key: String, value: JSONArray) {
        SecureStorage.set(context, key, value.toString())
    }
}