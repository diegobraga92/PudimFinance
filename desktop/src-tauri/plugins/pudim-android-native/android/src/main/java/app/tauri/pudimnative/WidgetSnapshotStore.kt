package app.tauri.pudimnative

import android.content.Context
import android.content.res.Configuration
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object WidgetSnapshotStore {
    const val PREFS_NAME = "pudim_widget_prefs"
    private const val KEY_SPENDING = "spending_json"
    private const val KEY_THEME = "theme"

    fun load(context: Context): WidgetSpendingSnapshot {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_SPENDING, null)
        val fallback = defaultSnapshot(context)
        if (raw.isNullOrBlank()) return fallback
        return try {
            WidgetSpendingCodec.parse(raw)
        } catch (_: Exception) {
            fallback
        }
    }

    fun loadRolledForward(context: Context): WidgetSpendingSnapshot {
        val snapshot = load(context)
        val locale = snapshot.locale.ifBlank { "en" }
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val rolled = WidgetSpendingLogic.rollForward(snapshot, today, locale)
        if (rolled != snapshot) save(context, rolled)
        return rolled
    }

    fun save(context: Context, snapshot: WidgetSpendingSnapshot) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SPENDING, WidgetSpendingCodec.stringify(snapshot))
            .apply()
    }

    fun theme(context: Context): WidgetTheme {
        val stored = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_THEME, null)
        return when (stored) {
            "light" -> WidgetTheme.LIGHT
            "dark" -> WidgetTheme.DARK
            else -> if ((context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES) {
                WidgetTheme.DARK
            } else {
                WidgetTheme.LIGHT
            }
        }
    }

    fun saveTheme(context: Context, theme: WidgetTheme) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, if (theme == WidgetTheme.DARK) "dark" else "light")
            .apply()
    }

    private fun defaultSnapshot(context: Context): WidgetSpendingSnapshot {
        val locale = context.resources.configuration.locales[0]?.toLanguageTag() ?: "en"
        val normalizedLocale = if (locale.lowercase(Locale.US).startsWith("pt")) "pt-BR" else "en"
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val days = (6 downTo 0).map { offset ->
            val calendar = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, -offset) }
            val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(calendar.time)
            WidgetDay(date, WidgetSpendingLogic.weekdayLabel(date, normalizedLocale), 0.0, offset == 0, 0)
        }
        return WidgetSpendingSnapshot(
            todayAmount = 0.0,
            todayTransactionCount = 0,
            days = days,
            currency = "BRL",
            locale = normalizedLocale,
            dateLabel = WidgetSpendingLogic.dateLabel(today, normalizedLocale),
            offline = true,
            lastUpdated = "",
            pendingSync = true,
        )
    }
}