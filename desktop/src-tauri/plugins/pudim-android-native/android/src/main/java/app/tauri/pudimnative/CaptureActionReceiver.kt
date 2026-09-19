package app.tauri.pudimnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Handles the income / debit / credit buttons on an import-prompt notification.
 *
 * When the WebView is active the choice is forwarded immediately through
 * [PudimNativePlugin.notifyCaptureAction] (the `captureAction` event).
 * Otherwise the choice is imported straight into the encrypted native outbox
 * ([NativeCaptureImporter.importAction]).
 *
 * Either way the choice is also persisted in [PendingCaptureActions], carrying
 * the uploaded transaction (including its `client_id`) when a native import
 * ran, so the app can materialize or retry it on the next drain instead of
 * losing a capture that was never shown in the review inbox.
 */
class CaptureActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val captureId = intent.getStringExtra(EXTRA_CAPTURE_ID) ?: return
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return

        // Tapping an action consumes the prompt.
        CapturePromptNotifier.cancel(context, captureId)

        val payload = mutableMapOf<String, Any?>(
            "capture_id" to captureId,
            "action" to action,
        )
        // Raw notification context, present only when the listener posted the
        // prompt (app was dead) — lets the webview replay the import later.
        intent.getStringExtra(EXTRA_APP_NAME)?.let { payload["app_name"] = it }
        intent.getStringExtra(EXTRA_APP_LABEL)?.let { payload["app_label"] = it }
        intent.getStringExtra(EXTRA_TITLE)?.let { payload["title"] = it }
        intent.getStringExtra(EXTRA_TEXT)?.let { payload["text"] = it }
        // Parsed fields carried by in-app prompts, whose intent has no raw text.
        intent.getStringExtra(EXTRA_DESCRIPTION)?.let { payload["description"] = it }
        intent.getStringExtra(EXTRA_AMOUNT)?.let { payload["amount"] = it }
        intent.getStringExtra(EXTRA_TYPE)?.let { payload["type"] = it }
        intent.getStringExtra(EXTRA_DATE)?.let { payload["date"] = it }
        intent.getStringExtra(EXTRA_CATEGORY_ID)?.let { payload["category_id"] = it }
        val postTime = intent.getLongExtra(EXTRA_POST_TIME, 0L)
        if (postTime > 0L) payload["post_time"] = postTime

        // A capture the listener already imported (Android can redeliver an
        // action) is owned by the sync outbox, so it must not be imported twice.
        if (NativeCaptureJournal.contains(context, captureId)) {
            Log.i(TAG, "action=$action capture=$captureId ignored: already imported")
            NotificationCaptureQueue.removeByCaptureId(context, captureId)
            return
        }

        val forwarded = PudimNativePlugin.notifyCaptureAction(payload)
        if (!forwarded) {
            // No WebView listener: import immediately into the encrypted native
            // outbox so the tap still creates a transaction. A failure here must
            // never lose the tap, because the journal below always runs.
            val imported = runCatching { NativeCaptureImporter.importAction(context, payload) }
                .onFailure {
                    Log.w(TAG, "action=$action capture=$captureId native import failed; keeping it for the app", it)
                }
                .getOrNull()
            if (imported != null) {
                payload.putAll(
                    NativeCaptureImporter.importPayload(
                        payload,
                        captureId,
                        imported.clientId,
                        imported.plan,
                        context.getString(R.string.capture_notes),
                    ),
                )
            }
        }

        Log.i(
            TAG,
            "action=$action capture=$captureId " + when {
                forwarded -> "forwarded to the app"
                payload.containsKey("client_id") -> "imported natively (client=${payload["client_id"]})"
                else -> "queued for the app"
            },
        )

        // Always journal: if the WebView never sees this, the action is drained
        // on the next launch and completes the import.
        PendingCaptureActions.enqueue(context, payload)
    }

    companion object {
        private const val TAG = "PudimCapture"
        const val ACTION = "app.tauri.pudimnative.CAPTURE_ACTION"
        const val EXTRA_CAPTURE_ID = "capture_id"
        const val EXTRA_ACTION = "action"
        const val EXTRA_APP_NAME = "app_name"
        const val EXTRA_APP_LABEL = "app_label"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_DESCRIPTION = "description"
        const val EXTRA_AMOUNT = "amount"
        const val EXTRA_TYPE = "type"
        const val EXTRA_DATE = "date"
        const val EXTRA_CATEGORY_ID = "category_id"
        const val EXTRA_POST_TIME = "post_time"
    }
}
