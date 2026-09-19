package app.tauri.pudimnative

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.util.UUID

/** Materializes dead-WebView notification captures into the native sync outbox. */
internal object NativeCaptureImporter {

    private const val TAG = "PudimCapture"

    /** `YYYY-MM-DD` check for dates that travelled from the WebView. */
    private val isoDate = Regex("\\d{4}-\\d{2}-\\d{2}")

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
     * Imports a tapped prompt action into the encrypted outbox.
     *
     * Returns null when settings or the notification prevent an import, so the
     * caller keeps the raw action journaled for the WebView instead of
     * consuming the capture. Callers are expected to have filtered captures
     * that were already imported ([NativeCaptureJournal.contains]).
     */
    fun importAction(context: Context, payload: Map<String, Any?>): NativeCaptureImport? {
        val captureId = payload["capture_id"] as? String ?: return null
        val action = payload["action"] as? String ?: return null
        val settings = CaptureSettingsStore.read(context)
        val parsed = parsePayload(payload, settings.defaultCategoryId)
        if (parsed == null) {
            Log.i(TAG, "capture=$captureId not imported: no amount found in the notification or action")
            return null
        }
        val plan = CaptureImportPlanner.planForAction(
            action,
            parsed,
            settings.defaultCategoryId,
            settings.debitAccountId,
            settings.creditAccountId,
        )
        if (plan == null) {
            Log.i(TAG, "capture=$captureId not imported: unknown action '$action'")
            return null
        }
        val notes = context.getString(R.string.capture_notes)
        val clientId = UUID.randomUUID().toString()
        enqueue(context, clientId, plan, notes)
        NativeCaptureJournal.add(context, captureId)
        NotificationCaptureQueue.removeByCaptureId(context, captureId)
        Log.i(
            TAG,
            "capture=$captureId imported natively: type=${plan.type} amount=${plan.amount} " +
                "account=${plan.accountId ?: "-"} category=${plan.categoryId ?: "-"}",
        )
        return NativeCaptureImport(clientId, plan)
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


    /** Prefers fields the WebView already parsed, then falls back to the text. */
    private fun parsePayload(payload: Map<String, Any?>, fallbackCategoryId: String?): ParsedCapture? {
        providedCapture(payload, fallbackCategoryId)?.let { return it }
        val text = listOfNotNull(payload["title"] as? String, payload["text"] as? String)
            .filter(String::isNotBlank)
            .joinToString(" ")
        return CaptureParser.parse(text, fallbackCategoryId)
    }

    /**
     * Rebuilds a capture from the fields attached to a prompt action. An in-app
     * prompt does not carry the original notification text, so without this the
     * native fallback could not import it while the app was asleep.
     */
    private fun providedCapture(payload: Map<String, Any?>, fallbackCategoryId: String?): ParsedCapture? {
        val rawAmount = payload["amount"] as? String ?: return null
        val amount = CaptureParser.normalizeAmount(rawAmount)
        if ((amount.toDoubleOrNull() ?: 0.0) <= 0.0) return null
        val type = (payload["type"] as? String)?.takeIf { it == "income" || it == "expense" } ?: "expense"
        val date = (payload["date"] as? String)?.takeIf(isoDate::matches) ?: CaptureParser.todayIso()
        val categoryId = (payload["category_id"] as? String)?.takeIf(String::isNotBlank)
            ?: fallbackCategoryId
        val description = (payload["description"] as? String)?.trim().orEmpty()
        return ParsedCapture(
            type = type,
            amount = amount,
            description = description.ifBlank { CaptureImportPlanner.FALLBACK_DESCRIPTION },
            date = date,
            categoryId = categoryId,
        )
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