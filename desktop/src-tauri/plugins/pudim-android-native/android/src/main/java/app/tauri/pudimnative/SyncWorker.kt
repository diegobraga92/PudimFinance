package app.tauri.pudimnative

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/** Uploads native captures and mirrored WebView mutations while the app is closed. */
internal class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val operations = orderedOperations(SyncOutbox.operations(applicationContext))
        if (operations.length() == 0) {
            PudimNativeLogs.info(TAG, "No pending operations")
            return Result.success()
        }
        val baseUrl = SyncOutbox.baseUrl(applicationContext) ?: run {
            PudimNativeLogs.info(TAG, "Retrying ${operations.length()} operation(s): base URL is not configured")
            return Result.retry()
        }
        val accessToken = SecureStorage.get(applicationContext, "pudim_token") ?: run {
            PudimNativeLogs.info(TAG, "Retrying ${operations.length()} operation(s): access token is unavailable")
            return Result.retry()
        }

        return try {
            var response = push(baseUrl, accessToken, operations)
            if (response.code == 401) {
                val refreshed = refresh(baseUrl)
                if (refreshed) {
                    PudimNativeLogs.info(TAG, "Access token refreshed")
                    val newAccess = SecureStorage.get(applicationContext, "pudim_token")
                    if (newAccess != null) response = push(baseUrl, newAccess, operations)
                }
            }
            when {
                response.code in 200..299 -> {
                    // The batch answers 200 even when individual operations
                    // failed, so the retry decision comes from the per-operation
                    // results, never from the HTTP status.
                    if (applyResults(operations, response.body)) {
                        PudimNativeLogs.info(TAG, "Retrying rejected operation(s), HTTP ${response.code}")
                        Result.retry()
                    } else {
                        Result.success()
                    }
                }
                response.code == 401 -> {
                    PudimNativeLogs.info(TAG, "Retrying ${operations.length()} operation(s): authorization failed")
                    Result.retry()
                }
                response.code in 400..499 -> {
                    // Journaled for the foreground UI and retried a bounded
                    // number of times, so a bad request cannot silently drop
                    // every pending capture.
                    if (recordBatchError(operations, response.body.ifBlank { "HTTP ${response.code}" })) {
                        PudimNativeLogs.info(TAG, "Retrying ${operations.length()} operation(s): HTTP ${response.code}")
                        Result.retry()
                    } else {
                        Result.success()
                    }
                }
                else -> {
                    PudimNativeLogs.info(TAG, "Retrying ${operations.length()} operation(s): HTTP ${response.code}")
                    Result.retry()
                }
            }
        } catch (error: Exception) {
            PudimNativeLogs.info(TAG, "Retrying ${operations.length()} operation(s): ${error.message ?: error.javaClass.simpleName}")
            Result.retry()
        }
    }

    private fun push(baseUrl: String, token: String, operations: JSONArray): HttpResponse {
        val connection = (URL("$baseUrl/api/sync/push").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 8_000
            readTimeout = 15_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }
        connection.outputStream.use {
            it.write(JSONObject().put("operations", operations).toString().toByteArray(Charsets.UTF_8))
        }
        val code = connection.responseCode
        val stream = if (code >= 400) connection.errorStream else connection.inputStream
        val body = stream?.let { input ->
            BufferedReader(InputStreamReader(input, Charsets.UTF_8)).use { it.readText() }
        }.orEmpty()
        connection.disconnect()
        return HttpResponse(code, body)
    }

    private fun refresh(baseUrl: String): Boolean {
        val refreshToken = SecureStorage.get(applicationContext, "pudim_refresh_token") ?: return false
        val connection = (URL("$baseUrl/api/auth/refresh").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 8_000
            readTimeout = 15_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        connection.outputStream.use {
            it.write(JSONObject().put("refresh_token", refreshToken).toString().toByteArray(Charsets.UTF_8))
        }
        val code = connection.responseCode
        val stream = if (code >= 400) connection.errorStream else connection.inputStream
        val body = stream?.let { input ->
            BufferedReader(InputStreamReader(input, Charsets.UTF_8)).use { it.readText() }
        }.orEmpty()
        connection.disconnect()
        if (code !in 200..299) return false
        val json = JSONObject(body)
        val access = json.optString("access_token")
        val refreshed = json.optString("refresh_token")
        if (access.isBlank() || refreshed.isBlank()) return false
        // Store both with commit semantics; the next foreground request can
        // reload the rotated refresh token instead of using a stale cache.
        SecureStorage.set(applicationContext, "pudim_token", access)
        SecureStorage.set(applicationContext, "pudim_refresh_token", refreshed)
        return true
    }

    private fun applyResults(operations: JSONArray, body: String): Boolean {
        val results = try { JSONObject(body).optJSONArray("results") ?: JSONArray() } catch (_: Exception) { JSONArray() }
        val byId = HashMap<String, JSONObject>()
        for (index in 0 until results.length()) {
            val result = results.optJSONObject(index) ?: continue
            byId[result.optString("client_id")] = result
        }
        var settled = 0
        var failed = 0
        var retry = false
        for (index in 0 until operations.length()) {
            val operation = operations.optJSONObject(index) ?: continue
            val clientId = operation.optString("client_id")
            val result = byId.remove(clientId)
            if (result == null) {
                // The batch answered for other operations only; keep this one.
                PudimNativeLogs.warn(TAG, "operation $clientId has no result in the batch; keeping it")
                failed += 1
                retry = true
                continue
            }
            val status = result.optString("status")
            val error = result.optString("error").takeIf { it.isNotBlank() }
            val warning = result.optString("warning").takeIf { it.isNotBlank() }
            val serverId = result.optString("server_id").takeIf { it.isNotBlank() }
            when (status) {
                "ok" -> {
                    if (warning != null) {
                        PudimNativeLogs.warn(TAG, "operation $clientId stored with a warning: $warning")
                    }
                    SyncOutbox.acknowledge(applicationContext, clientId)
                    SyncOutbox.recordResult(applicationContext, clientId, "ok", serverId, null, warning)
                    settled += 1
                }
                "conflict" -> {
                    // The server already holds this row, so the operation is done.
                    SyncOutbox.acknowledge(applicationContext, clientId)
                    SyncOutbox.recordResult(applicationContext, clientId, "conflict", null, error)
                    settled += 1
                }
                else -> {
                    // A rejected operation must never be dropped silently: the
                    // batch answers HTTP 200 even when an operation failed, and
                    // deleting it lost the capture. Retry a bounded number of
                    // times, then park it as a permanent failure for the UI.
                    failed += 1
                    val attempts = SyncOutbox.bumpAttempt(applicationContext, clientId)
                    when (SyncResultPolicy.decide(status, attempts, MAX_ATTEMPTS)) {
                        SyncResultPolicy.Action.RETRY -> {
                            PudimNativeLogs.warn(
                                TAG,
                                "operation $clientId rejected (attempt $attempts/$MAX_ATTEMPTS): ${error ?: status}",
                            )
                            SyncOutbox.recordResult(applicationContext, clientId, status.ifBlank { "error" }, null, error)
                            retry = true
                        }
                        else -> {
                            PudimNativeLogs.warn(
                                TAG,
                                "operation $clientId rejected permanently after $attempts attempts: ${error ?: status}",
                            )
                            SyncOutbox.acknowledge(applicationContext, clientId)
                            SyncOutbox.recordResult(
                                applicationContext,
                                clientId,
                                "failed",
                                null,
                                "$attempts attempts: ${error ?: status}",
                            )
                        }
                    }
                }
            }
        }
        // Results for operations that are no longer queued still settle the
        // foreground mirror (e.g. a capture the WebView adopted).
        for (result in byId.values) {
            if (result.optString("status") != "ok") continue
            SyncOutbox.recordResult(
                applicationContext,
                result.optString("client_id"),
                "ok",
                result.optString("server_id").takeIf { it.isNotBlank() },
                null,
                result.optString("warning").takeIf { it.isNotBlank() },
            )
        }
        PudimNativeLogs.info(TAG, "Batch answered: $settled settled, $failed failed")
        return retry
    }

    /**
     * Journals a batch-level rejection.
     *
     * Operations are kept until they exhaust [MAX_ATTEMPTS], so one bad request
     * cannot drop every pending capture at once. Returns whether a retry is due.
     */
    private fun recordBatchError(operations: JSONArray, error: String): Boolean {
        PudimNativeLogs.warn(TAG, "batch rejected: $error (${operations.length()} operation(s))")
        var retry = false
        for (index in 0 until operations.length()) {
            val clientId = operations.optJSONObject(index)?.optString("client_id") ?: continue
            val attempts = SyncOutbox.bumpAttempt(applicationContext, clientId)
            if (attempts < MAX_ATTEMPTS) {
                SyncOutbox.recordResult(applicationContext, clientId, "error", error = error)
                retry = true
            } else {
                SyncOutbox.acknowledge(applicationContext, clientId)
                SyncOutbox.recordResult(applicationContext, clientId, "failed", error = "$attempts attempts: $error")
            }
        }
        return retry
    }

    /** Keeps native replay dependency-safe just like the foreground JS engine. */
    private fun orderedOperations(input: JSONArray): JSONArray {
        val values = (0 until input.length()).mapNotNull { input.optJSONObject(it) }
        return JSONArray().apply {
            values.sortedBy { if (it.optString("operation_type") == "create") 0 else 1 }
                .forEach { put(it) }
        }
    }

    private data class HttpResponse(val code: Int, val body: String)

    private companion object {
        const val TAG = "PudimSyncWorker"

        /** Delivery attempts before a rejected operation is parked for the UI. */
        const val MAX_ATTEMPTS = SyncResultPolicy.MAX_ATTEMPTS
    }
}