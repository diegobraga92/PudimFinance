package app.tauri.pudimnative

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** The flagship 4×2 spending overview widget. */
class QuickAddWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { widgetId ->
            WidgetRenderer.updateWidget(context, appWidgetManager, widgetId, WidgetVariant.FLAGSHIP_4X2)
        }
    }
}
