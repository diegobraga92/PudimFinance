package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * Covers the pure journal helpers behind `peekPendingCaptureActions` /
 * `ackCaptureActions`, where losing an entry means losing a tapped import.
 */
class PendingCaptureActionsTest {

    private fun action(captureId: String, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("capture_id" to captureId, "action" to "credit") + extra

    @Test
    fun decodeReturnsEveryQueuedActionWithoutClearingIt() {
        val raw = PendingCaptureActions.addItem(null, action("cap-1"))
        val rawWithTwo = PendingCaptureActions.addItem(raw, action("cap-2"))

        val peeked = PendingCaptureActions.decode(rawWithTwo)

        assertEquals(listOf("cap-1", "cap-2"), peeked.map { it["capture_id"] })
        // Peeking must be repeatable: the blob is the caller's, not a buffer.
        assertEquals(peeked, PendingCaptureActions.decode(rawWithTwo))
    }

    @Test
    fun addItemKeepsOnlyTheLatestEventPerCaptureId() {
        val first = PendingCaptureActions.addItem(null, action("cap-1", mapOf("action" to "credit")))
        val second = PendingCaptureActions.addItem(first, action("cap-1", mapOf("action" to "debit")))

        val items = PendingCaptureActions.decode(second)

        assertEquals(1, items.size)
        assertEquals("debit", items.single()["action"])
    }

    @Test
    fun addItemKeepsNullValuedFieldsAsAbsentKeys() {
        val items = PendingCaptureActions.decode(
            PendingCaptureActions.addItem(null, action("cap-1", mapOf("account_id" to null))),
        )

        assertEquals("cap-1", items.single()["capture_id"])
        assertEquals(null, items.single()["account_id"])
    }

    @Test
    fun addItemBoundsTheJournal() {
        var raw: String? = null
        repeat(PendingCaptureActions.MAX_ITEMS + 5) { index ->
            raw = PendingCaptureActions.addItem(raw, action("cap-$index"))
        }

        val items = PendingCaptureActions.decode(raw)

        assertEquals(PendingCaptureActions.MAX_ITEMS, items.size)
        // Oldest entries are dropped, newest kept.
        assertEquals("cap-${PendingCaptureActions.MAX_ITEMS + 4}", items.last()["capture_id"])
    }

    @Test
    fun ackRemovesOnlyTheAcknowledgedCaptureIds() {
        var raw: String? = null
        repeat(3) { index -> raw = PendingCaptureActions.addItem(raw, action("cap-$index")) }

        val acknowledged = PendingCaptureActions.removeItems(raw!!, setOf("cap-1"))

        assertEquals(
            listOf("cap-0", "cap-2"),
            PendingCaptureActions.decode(acknowledged).map { it["capture_id"] },
        )
    }

    @Test
    fun ackLeavesTheBlobUntouchedWhenNothingMatches() {
        val raw = PendingCaptureActions.addItem(null, action("cap-1"))

        // Same reference lets the caller detect a no-op instead of rewriting it.
        assertSame(raw, PendingCaptureActions.removeItems(raw, setOf("cap-unknown")))
        assertSame(raw, PendingCaptureActions.removeItems(raw, emptySet()))
    }

    @Test
    fun ackAllRemovesEveryEntry() {
        var raw: String? = null
        repeat(2) { index -> raw = PendingCaptureActions.addItem(raw, action("cap-$index")) }

        val acknowledged = PendingCaptureActions.removeItems(raw!!, setOf("cap-0", "cap-1"))

        assertNotEquals(raw, acknowledged)
        assertEquals(emptyList<Any>(), PendingCaptureActions.decode(acknowledged))
    }

    @Test
    fun decodeTreatsUnreadableJournalsAsEmpty() {
        // A truncated blob must not throw: the WebView would then re-import on
        // every drain and never acknowledge the entry.
        assertEquals(emptyList<Any>(), PendingCaptureActions.decode("not json"))
        assertEquals(emptyList<Any>(), PendingCaptureActions.decode(""))
        assertEquals(emptyList<Any>(), PendingCaptureActions.decode(null))
    }
}
