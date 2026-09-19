package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Covers the retry rule for a rejected sync operation.
 *
 * The worker used to acknowledge every per-operation answer, so a rejection
 * (e.g. a stale category id the server refused) deleted the capture: nothing on
 * the server, nothing in the app, only a warning in the log screen.
 */
class SyncResultPolicyTest {

    @Test
    fun aStoredOperationIsAcknowledged() {
        assertEquals(
            SyncResultPolicy.Action.ACKNOWLEDGE,
            SyncResultPolicy.decide("ok", attempts = 1),
        )
    }

    @Test
    fun aConflictIsAcknowledgedBecauseTheServerAlreadyHasTheRow() {
        assertEquals(
            SyncResultPolicy.Action.ACKNOWLEDGE,
            SyncResultPolicy.decide("conflict", attempts = 1),
        )
    }

    @Test
    fun aRejectedOperationIsRetriedUntilTheAttemptLimit() {
        assertEquals(SyncResultPolicy.Action.RETRY, SyncResultPolicy.decide("error", attempts = 1))
        assertEquals(SyncResultPolicy.Action.RETRY, SyncResultPolicy.decide("error", attempts = 2))
    }

    @Test
    fun aRejectedOperationIsParkedOnlyAfterTheLimit() {
        assertEquals(
            SyncResultPolicy.Action.PARK,
            SyncResultPolicy.decide("error", attempts = SyncResultPolicy.MAX_ATTEMPTS),
        )
        assertEquals(SyncResultPolicy.Action.PARK, SyncResultPolicy.decide("failed", attempts = 9))
    }

    @Test
    fun theAttemptLimitIsConfigurableForTheCaller() {
        assertEquals(SyncResultPolicy.Action.PARK, SyncResultPolicy.decide("error", attempts = 2, maxAttempts = 2))
        assertEquals(SyncResultPolicy.Action.RETRY, SyncResultPolicy.decide("error", attempts = 1, maxAttempts = 2))
    }

    @Test
    fun anUnknownStatusIsTreatedAsARejection() {
        // Anything that is not "ok"/"conflict" must keep the capture rather than
        // silently drop it.
        assertEquals(SyncResultPolicy.Action.RETRY, SyncResultPolicy.decide("", attempts = 1))
        assertEquals(SyncResultPolicy.Action.RETRY, SyncResultPolicy.decide("queued", attempts = 1))
    }
}
