package app.tauri.pudimnative

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.format.DateUtils
import android.view.View
import android.widget.RemoteViews

enum class WidgetVariant { FLAGSHIP_4X2, WIDE_4X1, COMPACT_2X1 }
enum class WidgetTheme { LIGHT, DARK }

object WidgetRenderer {
    private const val REQ_DASHBOARD = 2000
    private const val REQ_EXPENSE = 3000

    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        updateProvider(context, manager, QuickAddWidgetProvider::class.java, WidgetVariant.FLAGSHIP_4X2)
        updateProvider(context, manager, QuickAddWidgetWideProvider::class.java, WidgetVariant.WIDE_4X1)
        updateProvider(context, manager, QuickAddWidgetSmallProvider::class.java, WidgetVariant.COMPACT_2X1)
    }

    fun pushSnapshot(context: Context, snapshot: WidgetSpendingSnapshot) {
        WidgetSnapshotStore.save(context, snapshot.copy(pendingSync = false))
        updateAll(context)
    }

    fun pushTheme(context: Context, theme: WidgetTheme) {
        WidgetSnapshotStore.saveTheme(context, theme)
        updateAll(context)
    }

    fun updateWidget(context: Context, manager: AppWidgetManager, widgetId: Int, variant: WidgetVariant) {
        val snapshot = WidgetSnapshotStore.loadRolledForward(context)
        val views = render(context, variant, snapshot, WidgetSnapshotStore.theme(context))
        views.setOnClickPendingIntent(R.id.widget_root, deepLinkPendingIntent(context, "dashboard", REQ_DASHBOARD + widgetId))
        views.setOnClickPendingIntent(R.id.widget_add_expense, deepLinkPendingIntent(context, "add?type=expense", REQ_EXPENSE + widgetId))
        manager.updateAppWidget(widgetId, views)
    }

    fun render(context: Context, variant: WidgetVariant, snapshot: WidgetSpendingSnapshot, theme: WidgetTheme): RemoteViews {
        val layout = when (variant) {
            WidgetVariant.FLAGSHIP_4X2 -> if (theme == WidgetTheme.DARK) R.layout.widget_spending_4x2_dark else R.layout.widget_spending_4x2_light
            WidgetVariant.WIDE_4X1 -> if (theme == WidgetTheme.DARK) R.layout.widget_spending_4x1_dark else R.layout.widget_spending_4x1_light
            WidgetVariant.COMPACT_2X1 -> if (theme == WidgetTheme.DARK) R.layout.widget_spending_2x1_dark else R.layout.widget_spending_2x1_light
        }
        return RemoteViews(context.packageName, layout).apply {
            setTextViewText(R.id.widget_date, snapshot.dateLabel)
            setTextViewText(R.id.widget_today_amount, WidgetSpendingLogic.formatMoney(snapshot.todayAmount, snapshot.currency, snapshot.locale))
            setTextViewText(R.id.widget_today_count, context.resources.getQuantityString(R.plurals.widget_spending_count, snapshot.todayTransactionCount, snapshot.todayTransactionCount))
            setTextViewText(R.id.widget_status, statusText(context, snapshot))
            setContentDescription(R.id.widget_today_amount, context.getString(R.string.widget_spending_today_content_description, WidgetSpendingLogic.formatMoney(snapshot.todayAmount, snapshot.currency, snapshot.locale)))
            setContentDescription(R.id.widget_add_expense, context.getString(R.string.widget_spending_add_expense_content_description))
            setViewVisibility(R.id.widget_status, if (variant == WidgetVariant.COMPACT_2X1) View.GONE else View.VISIBLE)
            setViewVisibility(R.id.widget_date, if (variant == WidgetVariant.COMPACT_2X1) View.GONE else View.VISIBLE)
            if (variant != WidgetVariant.COMPACT_2X1) populateBars(snapshot)
        }
    }

    private fun RemoteViews.populateBars(snapshot: WidgetSpendingSnapshot) {
        val days = snapshot.days.takeLast(7).let { list ->
            if (list.size == 7) list else List(7 - list.size) { WidgetDay("", "", 0.0, false, 0) } + list
        }
        val levels = WidgetSpendingLogic.barLevels(days)
        for (index in 0 until 7) {
            val position = index + 1
            val amountId = amountId(position)
            val barId = barId(position)
            val weekdayId = weekdayId(position)
            setTextViewText(amountId, WidgetSpendingLogic.formatCompactMoney(days[index].amount, snapshot.currency, snapshot.locale))
            setTextViewText(weekdayId, days[index].label)
            setProgressBar(barId, 10000, levels[index], false)
            setContentDescription(barId, "${days[index].label}: ${WidgetSpendingLogic.formatMoney(days[index].amount, snapshot.currency, snapshot.locale)}")
        }
    }

    private fun statusText(context: Context, snapshot: WidgetSpendingSnapshot): String {
        if (snapshot.pendingSync) return context.getString(R.string.widget_spending_not_synced)
        if (snapshot.offline) return context.getString(R.string.widget_spending_offline)
        if (snapshot.lastUpdated.isBlank()) return context.getString(R.string.widget_spending_synced_now)
        val parsed = try {
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", java.util.Locale.US)
                .parse(snapshot.lastUpdated)?.time ?: 0L
        } catch (_: Exception) {
            0L
        }
        val relative = if (parsed > 0L) DateUtils.getRelativeTimeSpanString(parsed, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS) else context.getString(R.string.widget_spending_synced_now)
        return context.getString(R.string.widget_spending_updated_at, relative)
    }

    private fun updateProvider(context: Context, manager: AppWidgetManager, provider: Class<*>, variant: WidgetVariant) {
        val ids = manager.getAppWidgetIds(ComponentName(context, provider))
        ids.forEach { updateWidget(context, manager, it, variant) }
    }

    private fun deepLinkPendingIntent(context: Context, link: String, requestCode: Int): PendingIntent {
        val intent = (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(DEEP_LINK_EXTRA, link)
        }
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun amountId(position: Int): Int = when (position) {
        1 -> R.id.widget_amount_1; 2 -> R.id.widget_amount_2; 3 -> R.id.widget_amount_3
        4 -> R.id.widget_amount_4; 5 -> R.id.widget_amount_5; 6 -> R.id.widget_amount_6
        else -> R.id.widget_amount_7
    }

    private fun barId(position: Int): Int = when (position) {
        1 -> R.id.widget_bar_1; 2 -> R.id.widget_bar_2; 3 -> R.id.widget_bar_3
        4 -> R.id.widget_bar_4; 5 -> R.id.widget_bar_5; 6 -> R.id.widget_bar_6
        else -> R.id.widget_bar_7
    }

    private fun weekdayId(position: Int): Int = when (position) {
        1 -> R.id.widget_weekday_1; 2 -> R.id.widget_weekday_2; 3 -> R.id.widget_weekday_3
        4 -> R.id.widget_weekday_4; 5 -> R.id.widget_weekday_5; 6 -> R.id.widget_weekday_6
        else -> R.id.widget_weekday_7
    }
}