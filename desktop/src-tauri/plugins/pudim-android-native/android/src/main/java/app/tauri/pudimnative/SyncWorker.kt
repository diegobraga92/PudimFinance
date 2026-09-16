package app.tauri.pudimnative

import android.content.Context
import android.util.Log
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
            Log.i(TAG, "No pending operations")
            return Result.success()
        }
        val baseUrl = SyncOutbox.baseUrl(applicationContext) ?: run {
            Log.i(TAG, "Retrying ${operations.length()} operation(s): base URL is not configured")
            return Result.retry()
        }
        val accessToken = SecureStorage.get(applicationContext, "pudim_token") ?: run {
            Log.i(TAG, "Retrying ${operations.length()} operation(s): access token is unavailable")
            return Result.retry()
        }

        return try {
            var response = push(baseUrl, accessToken, operations)
            if (response.code == 401) {
                val refreshed = refresh(baseUrl)
                if (refreshed) {
                    Log.i(TAG, "Access token refreshed")
                    val newAccess = SecureStorage.get(applicationContext, "pudim_token")
                    if (newAccess != null) response = push(baseUrl, newAccess, operations)
                }
            }
            when {
                response.code in 200..299 -> {
                    applyResults(operations, response.body)
                    Log.i(TAG, "Applied ${operations.length()} operation(s), HTTP ${response.code}")
                    Result.success()
                }
                response.code == 401 -> {
                    Log.i(TAG, "Retrying ${operations.length()} operation(s): authorization failed")
                    Result.retry()
                }
                response.code in 400..499 -> {
                    // A permanent per-batch HTTP error is journaled for the
                    // foreground UI and removed so WorkManager does not spin
                    // forever on a malformed payload.
                    recordBatchError(operations, response.body.ifBlank { "HTTP ${response.code}" })
                    Log.i(TAG, "Recorded permanent batch failure for ${operations.length()} operation(s), HTTP ${response.code}")
                    Result.success()
                }
                else -> {
                    Log.i(TAG, "Retrying ${operations.length()} operation(s): HTTP ${response.code}")
                    Result.retry()
                }
            }
        } catch (error: Exception) {
            Log.i(TAG, "Retrying ${operations.length()} operation(s): ${error.message ?: error.javaClass.simpleName}")
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

    private fun applyResults(operations: JSONArray, body: String) {
        val results = try { JSONObject(body).optJSONArray("results") ?: JSONArray() } catch (_: Exception) { JSONArray() }
        val byId = HashMap<String, JSONObject>()
        for (index in 0 until results.length()) {
            val result = results.optJSONObject(index) ?: continue
            byId[result.optString("client_id")] = result
        }
        for (index in 0 until operations.length()) {
            val operation = operations.optJSONObject(index) ?: continue
            val clientId = operation.optString("client_id")
            val result = byId[clientId] ?: continue
            if (result.optString("status") == "ok") {
                SyncOutbox.acknowledge(applicationContext, clientId)
            } else {
                SyncOutbox.acknowledge(applicationContext, clientId)
                SyncOutbox.recordResult(
                    applicationContext,
                    clientId,
                    result.optString("status", "error"),
                    result.optString("server_id").takeIf { it.isNotBlank() },
                    result.optString("error").takeIf { it.isNotBlank() },
                )
            }
        }
        for (index in 0 until results.length()) {
            val result = results.optJSONObject(index) ?: continue
            if (result.optString("status") == "ok") {
                SyncOutbox.recordResult(
                    applicationContext,
                    result.optString("client_id"),
                    "ok",
                    result.optString("server_id").takeIf { it.isNotBlank() },
                )
            }
        }
    }

    private fun recordBatchError(operations: JSONArray, error: String) {
        for (index in 0 until operations.length()) {
            val clientId = operations.optJSONObject(index)?.optString("client_id") ?: continue
            SyncOutbox.acknowledge(applicationContext, clientId)
            SyncOutbox.recordResult(applicationContext, clientId, "error", error = error)
        }
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
    }
}