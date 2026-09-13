package app.tauri.pudimnative

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * PudimFinance home-screen widget that shows "Spent today" and two buttons that
 * deep-link into the app's Add Transaction form (type pre-selected).
 *
 * The widget reads the "spent today" value from SharedPreferences, and the JS side
 * pushes fresh values via the `setWidgetSpentToday` command. The deep link is
 * carried as an Intent extra on the launch intent (no custom URI scheme needed).
 */
class QuickAddWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { widgetId -> updateWidget(context, appWidgetManager, widgetId) }
    }

    companion object {
        private const val PREFS_NAME = "pudim_widget_prefs"
        private const val KEY_SPENT_TODAY = "spent_today"
        private const val DEFAULT_SPENT_TODAY = "R$ 0,00"
        private const val REQ_EXPENSE = 1001
        private const val REQ_INCOME = 1002

        /** Stores a fresh "spent today" value and re-renders every widget. */
        fun pushSpentToday(context: Context, value: String) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SPENT_TODAY, value)
                .apply()
            updateAll(context)
        }

        fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            widgetId: Int,
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val spentToday = prefs.getString(KEY_SPENT_TODAY, DEFAULT_SPENT_TODAY)
                ?: DEFAULT_SPENT_TODAY
            val spentLabel = context.getString(R.string.widget_quickadd_spent_prefix)

            val views = RemoteViews(context.packageName, R.layout.widget_quick_add).apply {
                setTextViewText(R.id.widget_spent_today, "$spentLabel $spentToday")
                setOnClickPendingIntent(
                    R.id.widget_add_expense,
                    deepLinkPendingIntent(context, "add?type=expense", REQ_EXPENSE),
                )
                setOnClickPendingIntent(
                    R.id.widget_add_income,
                    deepLinkPendingIntent(context, "add?type=income", REQ_INCOME),
                )
            }
            appWidgetManager.updateAppWidget(widgetId, views)
        }

        /** Re-render every widget instance on the home screen. */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, QuickAddWidgetProvider::class.java),
            )
            ids.forEach { widgetId -> updateWidget(context, manager, widgetId) }
        }

        /** PendingIntent that opens the app and delivers the deep link as an extra. */
        private fun deepLinkPendingIntent(context: Context, link: String, requestCode: Int): PendingIntent {
            val intent = (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent())
                .apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    putExtra(DEEP_LINK_EXTRA, link)
                }
            return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
