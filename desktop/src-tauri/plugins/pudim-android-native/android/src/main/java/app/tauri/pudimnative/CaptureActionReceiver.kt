package app.tauri.pudimnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the Discard / Later buttons on a capture-prompt notification.
 *
 * Tapping either action consumes the prompt. Discard additionally drops the
 * capture everywhere: the raw notification is removed from
 * [NotificationCaptureQueue] and the choice is reported to the WebView
 * ([PudimNativePlugin.notifyCaptureAction], the `captureAction` event) so an
 * open review inbox drops it immediately. The choice is always persisted in
 * [PendingCaptureActions] too, so a WebView that is asleep (or crashes) applies
 * the discard on the next drain instead of leaving the capture behind.
 *
 * "Later" needs no bookkeeping: the capture already sits in
 * [NotificationCaptureQueue] (or the in-app inbox) and shows up on the
 * pending-review screen on the next drain.
 */
class CaptureActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val captureId = intent.getStringExtra(EXTRA_CAPTURE_ID) ?: return
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return

        // Tapping an action consumes the prompt.
        CapturePromptNotifier.cancel(context, captureId)

        when (action) {
            CapturePromptNotifier.ACTION_DISCARD -> {
                // Drop the queued raw notification so a later drain cannot bring
                // the discarded capture back into the review inbox.
                NotificationCaptureQueue.removeByCaptureId(context, captureId)
                val payload = mutableMapOf<String, Any?>(
                    "capture_id" to captureId,
                    "action" to action,
                )
                val forwarded = PudimNativePlugin.notifyCaptureAction(payload)
                // Always journal: if the WebView never sees this, the discard is
                // applied on the next launch instead of resurrecting the capture.
                PendingCaptureActions.enqueue(context, payload)
                PudimNativeLogs.info(
                    TAG,
                    "action=$action capture=$captureId " +
                        if (forwarded) "forwarded to the app" else "queued for the app",
                )
            }
            CapturePromptNotifier.ACTION_LATER -> {
                PudimNativeLogs.info(TAG, "action=$action capture=$captureId kept for review")
            }
            else -> {
                PudimNativeLogs.warn(TAG, "unknown action '$action' for capture=$captureId")
            }
        }
    }

    companion object {
        private const val TAG = "PudimCapture"
        const val ACTION = "app.tauri.pudimnative.CAPTURE_ACTION"
        const val EXTRA_CAPTURE_ID = "capture_id"
        const val EXTRA_ACTION = "action"
    }
}
