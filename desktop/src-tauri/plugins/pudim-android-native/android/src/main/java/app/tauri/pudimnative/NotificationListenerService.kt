package app.tauri.pudimnative

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/** Matches the amount markers common in Brazilian bank/payment alerts. */
private val FINANCIAL_TEXT_REGEX = Regex(
    "R\\$\\s*[0-9]|[0-9][0-9.,]*\\s*(reais|real|brl)",
    RegexOption.IGNORE_CASE,
)

/**
 * Android system service that observes notifications posted by ANY app once the
 * user grants "Notification access" (Settings, then Special app access, then
 * Notification access).
 *
 * While the app process is alive, each notification is forwarded to the webview
 * through [PudimNativePlugin], which parses it and may post an import prompt.
 *
 * Android keeps this service bound and restarts it after the app is killed, so
 * capture keeps working. In that case the webview is unavailable, so the
 * listener checks the mirrored settings ([CaptureSettingsStore]), detects an
 * amount, posts the import prompt itself ([CapturePromptNotifier]) and persists
 * the notification (with a `capture_id`/`prompted` flag) for the next launch.
 */
class NotificationListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // Do not feed PudimFinance's own capture prompts back into the bank
        // notification pipeline.
        if (sbn.packageName == packageName) return
        val appLabel = appLabelOf(this, sbn.packageName)
        val payload = extractPayload(sbn, appLabel) ?: return

        if (PudimNativePlugin.notifyPosted(payload)) {
            // Webview alive: let JS parse and prompt (single source of truth).
            return
        }

        val settings = CaptureSettingsStore.read(this)
        val watched = settings.enabled &&
            (settings.monitoredApps.isEmpty() || settings.monitoredApps.contains(appLabel))
        val text = listOfNotNull(payload["title"] as? String, payload["text"] as? String)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .trim()
        val captureId = "cap-${sbn.postTime}-${Integer.toHexString(text.hashCode())}"
        val shouldPrompt = watched && settings.pushPrompt && FINANCIAL_TEXT_REGEX.containsMatchIn(text)

        if (shouldPrompt) {
            CapturePromptNotifier.show(
                this,
                captureId,
                getString(R.string.capture_prompt_title, appLabel),
                text,
                appLabel,
                source = payload,
            )
        }

        // Always persist: the next launch drains it into the review inbox, and
        // `prompted` prevents asking about the same capture twice.
        NotificationCaptureQueue.enqueue(
            this,
            payload + mapOf("capture_id" to captureId, "prompted" to shouldPrompt),
        )
    }
}

/** Resolves the user-visible application label for a notification's package. */
internal fun appLabelOf(context: Context, packageName: String): String = try {
    @Suppress("DEPRECATION")
    val info = context.packageManager.getApplicationInfo(packageName, 0)
    context.packageManager.getApplicationLabel(info).toString()
} catch (_: Exception) {
    packageName
}

/**
 * Extracts the fields the webview consumes from a posted notification.
 * Returns null when the notification carries no body (nothing to parse).
 *
 * `app_name` stays the raw package (stable for de-dup) while `app_label` is the
 * human-readable name used by the monitored-apps filter and the prompt.
 */
internal fun extractPayload(sbn: StatusBarNotification, appLabel: String): Map<String, Any?>? {
    val notification = sbn.notification ?: return null
    val extras = notification.extras ?: return null

    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val body = buildString {
        extras.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString()?.let {
            append(it).append(' ')
        }
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.let {
            append(it).append(' ')
        }
        extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.let {
            append(it).append(' ')
        }
        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.joinToString(" ") { it?.toString().orEmpty() }
            ?.let { append(it) }
        extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.let {
            append(it).append(' ')
        }
        extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString()?.let {
            append(it)
        }
    }.trim()

    if (body.isEmpty()) return null

    return mapOf(
        "app_name" to sbn.packageName,
        "app_label" to appLabel,
        "title" to title,
        "text" to body,
        "post_time" to sbn.postTime,
    )
}

