package app.tauri.pudimnative

/**
 * What the sync worker must do with one operation after the server answered it.
 *
 * Kept free of Android types so the decision can be unit tested on the JVM:
 * dropping a rejected operation is what silently lost captures, so the rule
 * ("keep and retry, then park for the UI") has to be pinned down by a test.
 */
internal object SyncResultPolicy {

    /** Delivery attempts before a rejected operation is parked for the UI. */
    const val MAX_ATTEMPTS = 3

    enum class Action {
        /** The server stored it; remove it from the outbox. */
        ACKNOWLEDGE,

        /** Rejected, but worth another delivery: keep it and retry. */
        RETRY,

        /** Rejected for good: remove it after journaling the failure. */
        PARK,
    }

    /**
     * @param status the per-operation status of the push response.
     * @param attempts how many times this operation was rejected, including now.
     */
    fun decide(status: String, attempts: Int, maxAttempts: Int = MAX_ATTEMPTS): Action = when (status) {
        "ok", "conflict" -> Action.ACKNOWLEDGE
        else -> if (attempts < maxAttempts) Action.RETRY else Action.PARK
    }
}
