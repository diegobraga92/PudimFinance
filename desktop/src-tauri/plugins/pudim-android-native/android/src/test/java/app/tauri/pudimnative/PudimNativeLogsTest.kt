package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PudimNativeLogsTest {

    @Test
    fun recordsEntriesAndPagesByCursor() {
        PudimNativeLogs.clear()
        PudimNativeLogs.info("T", "first")
        PudimNativeLogs.warn("T", "second")

        val all = PudimNativeLogs.peek(0)
        assertEquals(2, all.size)
        assertEquals("first", all[0]["message"])
        assertEquals("warn", all[1]["level"])

        val cursor = all[1]["id"] as Long
        assertTrue(PudimNativeLogs.peek(cursor).isEmpty())
    }

    @Test
    fun keepsOnlyTheNewestEntries() {
        PudimNativeLogs.clear()
        repeat(305) { PudimNativeLogs.info("T", "entry $it") }

        val entries = PudimNativeLogs.peek(0)
        assertEquals(300, entries.size)
        // The first five records were dropped by the ring buffer.
        assertEquals("entry 5", entries.first()["message"])
        assertEquals("entry 304", entries.last()["message"])
    }

    @Test
    fun clearEmptiesTheBuffer() {
        PudimNativeLogs.info("T", "only")
        PudimNativeLogs.clear()
        assertTrue(PudimNativeLogs.peek(0).isEmpty())
    }
}
