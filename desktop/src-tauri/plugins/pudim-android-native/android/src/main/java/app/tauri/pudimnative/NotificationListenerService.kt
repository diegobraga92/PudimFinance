package app.tauri.pudimnative

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import app.tauri.plugin.JSObject

/**
 * Android system service that observes notifications posted by ANY app once the
 * user grants "Notification access" (Settings, then Special app access, then
 * Notification access).
 *
 * While the app process is alive, each notification is forwarded to the webview
 * through [PudimNativePlugin]. If the app was killed, the plugin doesn't exist yet,
 * so the raw notification is persisted in a durable queue
 * ([NotificationCaptureQueue]) and processed on the next app launch.
 */
class NotificationListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val payload = extractPayload(sbn) ?: return
        val plugin = PudimNativePlugin.instance
        if (plugin != null) {
            plugin.notifyPosted(payload)
        } else {
            // The webview/process isn't alive (app killed / cold-starting).
            // Persist the notification so the next launch can drain and process.
            NotificationCaptureQueue.enqueue(applicationContext, payload)
        }
    }
}

/**
 * Extracts the fields the webview consumes from a posted notification.
 * Returns null when the notification carries no body (nothing to parse).
 */
internal fun extractPayload(sbn: StatusBarNotification): Map<String, Any?>? {
    val notification = sbn.notification ?: return null
    val extras = notification.extras ?: return null

    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val body = buildString {
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.let {
            append(it).append(' ')
        }
        extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.let {
            append(it).append(' ')
        }
        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.joinToString(" ") { it?.toString().orEmpty() }
            ?.let { append(it) }
    }.trim()

    if (body.isEmpty()) return null

    return mapOf(
        "app_name" to sbn.packageName,
        "title" to title,
        "text" to body,
        "post_time" to sbn.postTime,
    )
}
