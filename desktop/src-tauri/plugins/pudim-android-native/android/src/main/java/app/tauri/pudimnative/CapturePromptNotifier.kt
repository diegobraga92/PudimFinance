package app.tauri.pudimnative

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Posts the "how do you want to import this?" notification for a captured bank
 * transaction, and handles the Android 13+ `POST_NOTIFICATIONS` opt-in.
 *
 * The notification offers three import actions (income / debit / credit) wired
 * to [CaptureActionReceiver], plus a content intent that opens the app on the
 * pending-review screen. Notifications are keyed by the capture id (tag) so a
 * later cancel/edit can address a single capture.
 */
internal object CapturePromptNotifier {
    private const val CHANNEL_ID = "pudim_capture_prompt"
    private const val NOTIFICATION_ID = 0

    /** Request code for the `POST_NOTIFICATIONS` runtime prompt. */
    const val PERMISSION_REQUEST_CODE = 4201

    /** Import kinds carried by the notification action buttons. */
    const val ACTION_INCOME = "income"
    const val ACTION_DEBIT = "debit"
    const val ACTION_CREDIT = "credit"

    /** Creates the heads-up channel once (no-op below Android O). */
    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.capture_prompt_channel_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.capture_prompt_channel_desc)
            },
        )
    }

    /** Posts (or replaces) the import prompt for [captureId]. */
    fun show(
        context: Context,
        captureId: String,
        title: String,
        body: String,
        appLabel: String,
        source: Map<String, Any?>? = null,
    ) {
        ensureChannel(context)
        if (!postingAllowed(context)) return

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(appIcon(context))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSubText(appLabel.ifBlank { null })
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openIntent(context, captureId))
            .addAction(action(context, captureId, ACTION_INCOME, context.getString(R.string.capture_prompt_income), source))
            .addAction(action(context, captureId, ACTION_DEBIT, context.getString(R.string.capture_prompt_debit), source))
            .addAction(action(context, captureId, ACTION_CREDIT, context.getString(R.string.capture_prompt_credit), source))
            .build()

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        NotificationManagerCompat.from(context).notify(captureId, NOTIFICATION_ID, notification)
    }

    /** Dismisses the import prompt for [captureId], if still visible. */
    fun cancel(context: Context, captureId: String) {
        NotificationManagerCompat.from(context).cancel(captureId, NOTIFICATION_ID)
    }

    /** Whether the OS currently lets PudimFinance post notifications. */
    fun postingAllowed(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    /**
     * Shows the `POST_NOTIFICATIONS` runtime prompt when still needed and
     * returns the resulting state. The user's answer is reflected on the next
     * [postingAllowed] call (the webview re-checks on window focus).
     */
    fun requestPermission(activity: Activity): Boolean {
        if (postingAllowed(activity)) return true
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                PERMISSION_REQUEST_CODE,
            )
        }
        return postingAllowed(activity)
    }

    /** Action button that reports the chosen import kind back to the webview. */
    private fun action(
        context: Context,
        captureId: String,
        action: String,
        label: String,
        source: Map<String, Any?>?,
    ): NotificationCompat.Action {
        val intent = Intent(context, CaptureActionReceiver::class.java).apply {
            this.action = CaptureActionReceiver.ACTION
            // Unique data URI keeps each capture/action PendingIntent distinct.
            data = Uri.parse("pudim-capture://action/$captureId/$action")
            putExtra(CaptureActionReceiver.EXTRA_CAPTURE_ID, captureId)
            putExtra(CaptureActionReceiver.EXTRA_ACTION, action)
            // When the listener posted the prompt (app was dead) the raw
            // notification travels with the action so the webview can import it
            // on next launch without needing a pre-existing inbox entry.
            source?.let { fields ->
                (fields["app_name"] as? String)?.let {
                    putExtra(CaptureActionReceiver.EXTRA_APP_NAME, it)
                }
                (fields["app_label"] as? String)?.let {
                    putExtra(CaptureActionReceiver.EXTRA_APP_LABEL, it)
                }
                (fields["title"] as? String)?.let {
                    putExtra(CaptureActionReceiver.EXTRA_TITLE, it)
                }
                (fields["text"] as? String)?.let {
                    putExtra(CaptureActionReceiver.EXTRA_TEXT, it)
                }
                (fields["post_time"] as? Long)?.let {
                    putExtra(CaptureActionReceiver.EXTRA_POST_TIME, it)
                }
            }
        }
        val requestCode = 31 * captureId.hashCode() + action.hashCode()
        val pending = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Action(0, label, pending)
    }

    /** Content intent that deep-links into the pending-review screen. */
    private fun openIntent(context: Context, captureId: String): PendingIntent {
        val intent = (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent())
            .apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(DEEP_LINK_EXTRA, "pending-review?capture=$captureId")
            }
        return PendingIntent.getActivity(
            context,
            captureId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** The host app's launcher icon, or a system fallback when unset. */
    private fun appIcon(context: Context): Int {
        val icon = context.applicationInfo.icon
        return if (icon != 0) icon else android.R.drawable.ic_dialog_info
    }
}
