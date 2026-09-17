package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSpendingCodecTest {
    @Test
    fun parsesAndSerializesTheWebviewContract() {
        val fixture = """
            {
              "today":{"amount":144,"transactionCount":2},
              "days":[
                {"date":"2026-09-10","label":"Thu","amount":15.75,"isToday":false,"transactionCount":2},
                {"date":"2026-09-11","label":"Fri","amount":0,"isToday":false,"transactionCount":0},
                {"date":"2026-09-12","label":"Sat","amount":20,"isToday":false,"transactionCount":1},
                {"date":"2026-09-13","label":"Sun","amount":0,"isToday":false,"transactionCount":0},
                {"date":"2026-09-14","label":"Mon","amount":0,"isToday":false,"transactionCount":0},
                {"date":"2026-09-15","label":"Tue","amount":0,"isToday":false,"transactionCount":0},
                {"date":"2026-09-16","label":"Wed","amount":144,"isToday":true,"transactionCount":2}
              ],
              "currency":"BRL","locale":"en","dateLabel":"Wed, Sep 16",
              "offline":true,"lastUpdated":"2026-09-16T12:00:00.000Z"
            }
        """.trimIndent()
        val snapshot = WidgetSpendingCodec.parse(fixture)
        assertEquals(144.0, snapshot.todayAmount, 0.0)
        assertEquals(2, snapshot.todayTransactionCount)
        assertEquals(7, snapshot.days.size)
        assertEquals("2026-09-16", snapshot.days.last().date)
        assertTrue(snapshot.days.last().isToday)
        assertEquals("BRL", snapshot.currency)
        assertTrue(snapshot.offline)
        assertFalse(snapshot.pendingSync)

        val roundTrip = WidgetSpendingCodec.parse(WidgetSpendingCodec.stringify(snapshot))
        assertEquals(snapshot.days, roundTrip.days)
        assertEquals(snapshot.todayAmount, roundTrip.todayAmount, 0.0)
        assertEquals(snapshot.lastUpdated, roundTrip.lastUpdated)
    }
}