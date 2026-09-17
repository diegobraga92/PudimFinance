package app.tauri.pudimnative

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

class QuickAddWidgetSmallProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { WidgetRenderer.updateWidget(context, manager, it, WidgetVariant.COMPACT_2X1) }
    }
}