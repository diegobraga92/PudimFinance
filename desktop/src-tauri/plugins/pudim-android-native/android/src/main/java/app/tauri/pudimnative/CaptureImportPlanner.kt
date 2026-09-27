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
 * Pure mapping from an auto-mode capture to the transaction fields the sync
 * outbox has to upload.
 *
 * Kept free of `Context` so the mapping can be unit tested on the JVM.
 */
internal object CaptureImportPlanner {

    /** Fallback description when the parser could not extract a merchant. */
    const val FALLBACK_DESCRIPTION = "Notificação bancária"

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
