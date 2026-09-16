package app.tauri.pudimnative

import android.content.Context
import org.json.JSONObject
import java.util.UUID

/** Materializes dead-WebView notification captures into the native sync outbox. */
internal object NativeCaptureImporter {
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
        val accountId = if (parsed.type == "expense") settings.debitAccountId else null
        enqueue(context, parsed, accountId)
        NativeCaptureJournal.add(context, captureId)
        NotificationCaptureQueue.removeByCaptureId(context, captureId)
        return true
    }

    fun importAction(context: Context, payload: Map<String, Any?>): Boolean {
        val captureId = payload["capture_id"] as? String ?: return false
        if (NativeCaptureJournal.contains(context, captureId)) {
            NotificationCaptureQueue.removeByCaptureId(context, captureId)
            return true
        }
        val settings = CaptureSettingsStore.read(context)
        val parsed = parsePayload(payload, settings.defaultCategoryId) ?: return false
        val action = payload["action"] as? String ?: return false
        val type = if (action == CapturePromptNotifier.ACTION_INCOME) "income" else "expense"
        val accountId = when (action) {
            CapturePromptNotifier.ACTION_DEBIT -> settings.debitAccountId
            CapturePromptNotifier.ACTION_CREDIT -> settings.creditAccountId
            else -> null
        }
        enqueue(context, parsed.copy(type = type), accountId)
        NativeCaptureJournal.add(context, captureId)
        NotificationCaptureQueue.removeByCaptureId(context, captureId)
        return true
    }

    private fun parsePayload(payload: Map<String, Any?>, fallbackCategoryId: String?): ParsedCapture? {
        val text = listOfNotNull(payload["title"] as? String, payload["text"] as? String)
            .filter(String::isNotBlank)
            .joinToString(" ")
        return CaptureParser.parse(text, fallbackCategoryId)
    }

    private fun enqueue(context: Context, parsed: ParsedCapture, accountId: String?) {
        val clientId = UUID.randomUUID().toString()
        val payload = JSONObject().apply {
            put("description", parsed.description)
            put("amount", parsed.amount)
            put("type", parsed.type)
            put("category_id", parsed.categoryId ?: JSONObject.NULL)
            put("date", parsed.date)
            put("notes", context.getString(R.string.capture_notes))
            put("account_id", accountId ?: JSONObject.NULL)
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