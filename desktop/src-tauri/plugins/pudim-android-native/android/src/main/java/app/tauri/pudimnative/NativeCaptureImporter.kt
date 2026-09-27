package app.tauri.pudimnative

import android.content.Context
import org.json.JSONObject
import java.util.UUID

/** Materializes dead-WebView notification captures into the native sync outbox. */
internal object NativeCaptureImporter {

    private const val TAG = "PudimCapture"

    fun importAuto(context: Context, payload: Map<String, Any?>): Boolean {
        val settings = CaptureSettingsStore.read(context)
        if (!settings.enabled || settings.mode != "auto") return false
        val appLabel = payload["app_label"] as? String ?: payload["app_name"] as? String ?: ""
        if (settings.monitoredApps.isNotEmpty() && !settings.monitoredApps.contains(appLabel)) return false
        val captureId = payload["capture_id"] as? String ?: return false
        if (NativeCaptureJournal.contains(context, captureId)) {
            NotificationCaptureQueue.removeByCaptureId(context, captureId)
            return true
        }
        val parsed = parsePayload(payload, settings.defaultCategoryId) ?: return false
        val plan = CaptureImportPlanner.planForAuto(parsed, settings.defaultCategoryId, settings.debitAccountId)
        val notes = context.getString(R.string.capture_notes)
        val clientId = UUID.randomUUID().toString()
        enqueue(context, clientId, plan, notes)
        NativeCaptureJournal.add(context, captureId)
        NotificationCaptureQueue.removeByCaptureId(context, captureId)
        // The WebView will never see the queue entry again, so journal the
        // import for it to mirror the transaction locally on the next drain.
        PendingCaptureActions.enqueue(context, importPayload(payload, captureId, clientId, plan, notes))
        return true
    }

    /**
     * Payload journaled for the WebView after a native import: the raw
     * notification (when available) plus the transaction that was uploaded, so
     * the app can materialize the same local row without re-parsing.
     */
    fun importPayload(
        payload: Map<String, Any?>,
        captureId: String,
        clientId: String,
        plan: CaptureImportPlan,
        notes: String,
    ): Map<String, Any?> = payload + mapOf(
        "capture_id" to captureId,
        "client_id" to clientId,
        "native_import" to true,
        "description" to plan.description,
        "amount" to plan.amount,
        "type" to plan.type,
        "date" to plan.date,
        "category_id" to plan.categoryId,
        "account_id" to plan.accountId,
        "notes" to notes,
    )

    /** Parses the amount/merchant out of the captured notification text. */
    private fun parsePayload(payload: Map<String, Any?>, fallbackCategoryId: String?): ParsedCapture? {
        val text = listOfNotNull(payload["title"] as? String, payload["text"] as? String)
            .filter(String::isNotBlank)
            .joinToString(" ")
        return CaptureParser.parse(text, fallbackCategoryId)
    }

    private fun enqueue(context: Context, clientId: String, plan: CaptureImportPlan, notes: String) {
        val payload = JSONObject().apply {
            put("description", plan.description)
            put("amount", plan.amount)
            put("type", plan.type)
            put("category_id", plan.categoryId ?: JSONObject.NULL)
            put("date", plan.date)
            put("notes", notes)
            put("account_id", plan.accountId ?: JSONObject.NULL)
        }
        SyncOutbox.enqueue(
            context,
            JSONObject().apply {
                put("operation_type", "create")
                put("entity_type", "transaction")
                put("client_id", clientId)
                put("payload", payload)
            },
        )
    }
}