package app.tauri.pudimnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Re-renders immediately when Android reports a calendar or timezone change. */
class WidgetRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_DATE_CHANGED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> WidgetRenderer.updateAll(context)
        }
    }
}