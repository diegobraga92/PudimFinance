package app.tauri.pudimnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the income / debit / credit buttons on an import-prompt notification.
 *
 * When the webview is alive the choice is forwarded immediately through
 * [PudimNativePlugin.notifyCaptureAction] (the `captureAction` event). If the
 * app process is dead, the choice is persisted in [PendingCaptureActions] and
 * applied on the next launch.
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
        val postTime = intent.getLongExtra(EXTRA_POST_TIME, 0L)
        if (postTime > 0L) payload["post_time"] = postTime

        if (PudimNativePlugin.instance != null) {
            PudimNativePlugin.notifyCaptureAction(payload)
        } else {
            PendingCaptureActions.enqueue(context, payload)
        }
    }

    companion object {
        const val ACTION = "app.tauri.pudimnative.CAPTURE_ACTION"
        const val EXTRA_CAPTURE_ID = "capture_id"
        const val EXTRA_ACTION = "action"
        const val EXTRA_APP_NAME = "app_name"
        const val EXTRA_APP_LABEL = "app_label"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_POST_TIME = "post_time"
    }
}
