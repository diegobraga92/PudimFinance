package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSpendingLogicTest {
    @Test
    fun normalizesBarsAndKeepsZeroDaysAtZero() {
        val days = listOf(
            WidgetDay("2026-09-10", "Thu", 0.0, false),
            WidgetDay("2026-09-11", "Fri", 25.0, false),
            WidgetDay("2026-09-12", "Sat", 100.0, false),
        )
        assertEquals(listOf(0, 2500, 10000), WidgetSpendingLogic.barLevels(days))
        assertEquals(listOf(0, 0, 0), WidgetSpendingLogic.barLevels(days.map { it.copy(amount = 0.0) }))
    }

    @Test
    fun singleSmallNonZeroDayStillHasVisibleBar() {
        val levels = WidgetSpendingLogic.barLevels(
            listOf(
                WidgetDay("2026-09-10", "Thu", 0.01, false),
                WidgetDay("2026-09-11", "Fri", 10000.0, false),
            ),
        )
        assertEquals(1, levels[0])
        assertEquals(10000, levels[1])
    }

    @Test
    fun rollsCachedWindowIntoNewDayAndMarksItPending() {
        val snapshot = WidgetSpendingSnapshot(
            todayAmount = 42.0,
            todayTransactionCount = 2,
            days = (0..6).map { offset ->
                val date = "2026-09-${(10 + offset).toString().padStart(2, '0')}"
                WidgetDay(date, "old", if (offset == 6) 42.0 else 0.0, offset == 6)
            },
            currency = "BRL",
            locale = "en",
            dateLabel = "old",
            offline = false,
            lastUpdated = "2026-09-16T12:00:00.000Z",
        )
        val rolled = WidgetSpendingLogic.rollForward(snapshot, "2026-09-17", "en")
        assertEquals(7, rolled.days.size)
        assertEquals("2026-09-17", rolled.days.last().date)
        assertEquals(0.0, rolled.todayAmount, 0.0)
        assertEquals(0, rolled.todayTransactionCount)
        assertTrue(rolled.days.last().isToday)
        assertTrue(rolled.pendingSync)
        assertTrue(rolled.days.all { it.label.isNotBlank() })
    }

    @Test
    fun formatsCompactMoneyForPortugueseAndEnglish() {
        assertEquals("R$ 1,2k", WidgetSpendingLogic.formatCompactMoney(1234.0, "BRL", "pt-BR"))
        assertEquals("R$ 1.2k", WidgetSpendingLogic.formatCompactMoney(1234.0, "BRL", "en"))
        assertEquals("R$ 43", WidgetSpendingLogic.formatCompactMoney(43.0, "BRL", "pt-BR"))
    }
}