package app.tauri.pudimnative

import org.json.JSONArray
import org.json.JSONObject
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** One calendar day in the spending overview. Amounts are stored as raw numbers. */
data class WidgetDay(
    val date: String,
    val label: String,
    val amount: Double,
    val isToday: Boolean,
    val transactionCount: Int = 0,
)

/** JSON contract shared by the webview and the Android home-screen widget. */
data class WidgetSpendingSnapshot(
    val todayAmount: Double,
    val todayTransactionCount: Int,
    val days: List<WidgetDay>,
    val currency: String,
    val locale: String,
    val dateLabel: String,
    val offline: Boolean,
    val lastUpdated: String,
    val pendingSync: Boolean = false,
)

object WidgetSpendingCodec {
    fun parse(payload: String): WidgetSpendingSnapshot {
        val root = JSONObject(payload)
        val today = root.optJSONObject("today") ?: JSONObject()
        val daysJson = root.optJSONArray("days") ?: JSONArray()
        val days = buildList {
            for (index in 0 until daysJson.length()) {
                val day = daysJson.optJSONObject(index) ?: continue
                add(
                    WidgetDay(
                        date = day.optString("date"),
                        label = day.optString("label"),
                        amount = day.optDouble("amount", 0.0),
                        isToday = day.optBoolean("isToday", false),
                        transactionCount = day.optInt("transactionCount", 0),
                    ),
                )
            }
        }
        return WidgetSpendingSnapshot(
            todayAmount = today.optDouble("amount", 0.0),
            todayTransactionCount = today.optInt("transactionCount", 0),
            days = days,
            currency = root.optString("currency", "BRL"),
            locale = root.optString("locale", "en"),
            dateLabel = root.optString("dateLabel"),
            offline = root.optBoolean("offline", false),
            lastUpdated = root.optString("lastUpdated"),
            pendingSync = root.optBoolean("pendingSync", false),
        )
    }

    fun stringify(snapshot: WidgetSpendingSnapshot): String {
        val days = JSONArray()
        snapshot.days.forEach { day ->
            days.put(
                JSONObject()
                    .put("date", day.date)
                    .put("label", day.label)
                    .put("amount", day.amount)
                    .put("isToday", day.isToday)
                    .put("transactionCount", day.transactionCount),
            )
        }
        return JSONObject()
            .put(
                "today",
                JSONObject()
                    .put("amount", snapshot.todayAmount)
                    .put("transactionCount", snapshot.todayTransactionCount),
            )
            .put("days", days)
            .put("currency", snapshot.currency)
            .put("locale", snapshot.locale)
            .put("dateLabel", snapshot.dateLabel)
            .put("offline", snapshot.offline)
            .put("lastUpdated", snapshot.lastUpdated)
            .put("pendingSync", snapshot.pendingSync)
            .toString()
    }
}

object WidgetSpendingLogic {
    private const val ISO_PATTERN = "yyyy-MM-dd"

    /** Returns progress values in the renderer's 0..10000 range. */
    fun barLevels(days: List<WidgetDay>, maxAmount: Double = days.maxOfOrNull { it.amount } ?: 0.0): List<Int> {
        if (maxAmount <= 0.0) return days.map { 0 }
        return days.map { day ->
            if (day.amount <= 0.0) 0 else maxOf(1, ((day.amount / maxAmount) * 10000.0).toInt())
        }
    }

    /**
     * Advances a cached seven-day window without pretending the new day has
     * synchronized data. This is called by both the date receiver and renders.
     */
    fun rollForward(snapshot: WidgetSpendingSnapshot, todayIso: String, locale: String): WidgetSpendingSnapshot {
        val current = snapshot.days.toMutableList()
        if (current.isEmpty()) {
            current.addAll(buildDays(todayIso, locale))
        } else {
            var lastDate = current.last().date
            if (lastDate > todayIso) {
                current.clear()
                current.addAll(buildDays(todayIso, locale))
            } else {
                while (lastDate < todayIso) {
                    if (current.size >= 7) current.removeAt(0)
                    val next = addDays(lastDate, 1)
                    current.add(WidgetDay(next, weekdayLabel(next, locale), 0.0, next == todayIso, 0))
                    lastDate = next
                }
            }
        }
        val normalized = current.takeLast(7).map { day ->
            day.copy(label = weekdayLabel(day.date, locale), isToday = day.date == todayIso)
        }
        val today = normalized.lastOrNull { it.date == todayIso }
        return snapshot.copy(
            todayAmount = today?.amount ?: 0.0,
            todayTransactionCount = today?.transactionCount ?: 0,
            days = normalized,
            locale = locale,
            dateLabel = dateLabel(todayIso, locale),
            pendingSync = snapshot.pendingSync || snapshot.days.lastOrNull()?.date != todayIso,
        )
    }

    fun formatMoney(value: Double, currency: String, locale: String): String {
        val language = locale.lowercase(Locale.US)
        val symbols = DecimalFormatSymbols(languageLocale(locale))
        val formatter = DecimalFormat("#,##0.00", symbols)
        val symbol = when (currency.uppercase(Locale.US)) {
            "BRL" -> "R$"
            "USD" -> "$"
            "EUR" -> "€"
            else -> currency
        }
        return "$symbol ${formatter.format(value)}"
    }

    fun formatCompactMoney(value: Double, currency: String, locale: String): String {
        val absolute = kotlin.math.abs(value)
        val suffix: String
        val scaled: Double
        when {
            absolute >= 1_000_000.0 -> {
                scaled = value / 1_000_000.0
                suffix = "m"
            }
            absolute >= 1_000.0 -> {
                scaled = value / 1_000.0
                suffix = "k"
            }
            else -> return formatMoney(value, currency, locale).replace(",00", "").replace(".00", "")
        }
        val language = locale.lowercase(Locale.US)
        val decimal = if (language.startsWith("pt")) ',' else '.'
        val number = if (kotlin.math.abs(scaled) >= 100.0) {
            scaled.toInt().toString()
        } else {
            String.format(Locale.US, "%.1f", scaled).replace('.', decimal)
        }
        val symbol = when (currency.uppercase(Locale.US)) {
            "BRL" -> "R$"
            "USD" -> "$"
            "EUR" -> "€"
            else -> currency
        }
        return "$symbol $number$suffix"
    }

    fun weekdayLabel(iso: String, locale: String): String {
        val date = parseDate(iso) ?: return ""
        val languageLocale = languageLocale(locale)
        return SimpleDateFormat("EEE", languageLocale).format(date).trimEnd('.').replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(languageLocale) else it.toString()
        }
    }

    fun dateLabel(iso: String, locale: String): String {
        val date = parseDate(iso) ?: return iso
        val languageLocale = languageLocale(locale)
        return SimpleDateFormat("EEE, MMM d", languageLocale).format(date).trimEnd('.')
    }

    private fun buildDays(todayIso: String, locale: String): List<WidgetDay> =
        (6 downTo 0).map { offset ->
            val date = addDays(todayIso, -offset)
            WidgetDay(date, weekdayLabel(date, locale), 0.0, offset == 0, 0)
        }

    private fun addDays(iso: String, amount: Int): String {
        val calendar = Calendar.getInstance()
        calendar.time = parseDate(iso) ?: Date()
        calendar.add(Calendar.DAY_OF_YEAR, amount)
        return SimpleDateFormat(ISO_PATTERN, Locale.US).format(calendar.time)
    }

    private fun parseDate(iso: String): Date? = try {
        SimpleDateFormat(ISO_PATTERN, Locale.US).apply { isLenient = false }.parse(iso)
    } catch (_: Exception) {
        null
    }

    private fun languageLocale(locale: String): Locale =
        if (locale.lowercase(Locale.US).startsWith("pt")) Locale.forLanguageTag("pt-BR") else Locale.US
}