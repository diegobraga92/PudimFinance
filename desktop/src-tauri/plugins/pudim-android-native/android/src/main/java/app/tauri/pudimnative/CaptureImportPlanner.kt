package app.tauri.pudimnative

/** Transaction fields produced by importing a captured notification. */
internal data class CaptureImportPlan(
    val type: String,
    val accountId: String?,
    val categoryId: String?,
    val description: String,
    val amount: String,
    val date: String,
)

/**
 * Pure mapping from a capture prompt action (or an auto-mode capture) to the
 * transaction fields the sync outbox has to upload.
 *
 * Kept free of `Context` so the mapping can be unit tested on the JVM.
 */
internal object CaptureImportPlanner {

    /** Fallback description when the parser could not extract a merchant. */
    const val FALLBACK_DESCRIPTION = "Notificação bancária"

    /**
     * Maps a tapped action to its transaction fields.
     *
     * Income creates an income; debit and credit both create expenses and only
     * differ by the account the user configured for that payment method.
     * Returns null for unknown actions so an unexpected intent extra can never
     * import an arbitrary transaction.
     */
    fun planForAction(
        action: String,
        parsed: ParsedCapture,
        defaultCategoryId: String?,
        debitAccountId: String?,
        creditAccountId: String?,
    ): CaptureImportPlan? {
        val type = when (action) {
            CapturePromptNotifier.ACTION_INCOME -> "income"
            CapturePromptNotifier.ACTION_DEBIT, CapturePromptNotifier.ACTION_CREDIT -> "expense"
            else -> return null
        }
        val accountId = when (action) {
            CapturePromptNotifier.ACTION_DEBIT -> debitAccountId
            CapturePromptNotifier.ACTION_CREDIT -> creditAccountId
            else -> null
        }
        return CaptureImportPlan(
            type = type,
            accountId = accountId,
            categoryId = categoryId(type, parsed, defaultCategoryId),
            description = parsed.description.ifBlank { FALLBACK_DESCRIPTION },
            amount = parsed.amount,
            date = parsed.date,
        )
    }

    /** Maps an auto-mode capture, which keeps the parsed type and debit account. */
    fun planForAuto(
        parsed: ParsedCapture,
        defaultCategoryId: String?,
        debitAccountId: String?,
    ): CaptureImportPlan = CaptureImportPlan(
        type = parsed.type,
        accountId = if (parsed.type == "expense") debitAccountId else null,
        categoryId = categoryId(parsed.type, parsed, defaultCategoryId),
        description = parsed.description.ifBlank { FALLBACK_DESCRIPTION },
        amount = parsed.amount,
        date = parsed.date,
    )

    /** Parser guesses win; the configured default only fills expense gaps. */
    private fun categoryId(
        type: String,
        parsed: ParsedCapture,
        defaultCategoryId: String?,
    ): String? = parsed.categoryId ?: defaultCategoryId.takeIf { type == "expense" }
}
