package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptureImportPlannerTest {

    private val parsed = ParsedCapture(
        type = "expense",
        amount = "11.77",
        description = "DEEPSEERWEA",
        date = "2026-09-19",
        categoryId = null,
    )

    @Test
    fun autoPlanKeepsTheParsedTypeAndDebitAccount() {
        val plan = CaptureImportPlanner.planForAuto(
            parsed.copy(type = "expense"),
            defaultCategoryId = "cat-default",
            debitAccountId = "acc-debit",
        )
        assertEquals("expense", plan.type)
        assertEquals("acc-debit", plan.accountId)
        assertEquals("cat-default", plan.categoryId)
        assertEquals("11.77", plan.amount)
        assertEquals("DEEPSEERWEA", plan.description)
        assertEquals("2026-09-19", plan.date)
    }

    @Test
    fun autoIncomePlanHasNoAccount() {
        val plan = CaptureImportPlanner.planForAuto(
            parsed.copy(type = "income"),
            defaultCategoryId = "cat-default",
            debitAccountId = "acc-debit",
        )
        assertEquals("income", plan.type)
        assertNull(plan.accountId)
        // Income must not borrow the expense default category.
        assertNull(plan.categoryId)
    }

    @Test
    fun parsedCategoryWinsOverTheDefault() {
        val plan = CaptureImportPlanner.planForAuto(
            parsed.copy(categoryId = "cat-guessed"),
            defaultCategoryId = "cat-default",
            debitAccountId = null,
        )
        assertEquals("cat-guessed", plan.categoryId)
    }

    @Test
    fun blankDescriptionsFallBackToTheGenericLabel() {
        val plan = CaptureImportPlanner.planForAuto(
            parsed.copy(description = ""),
            defaultCategoryId = null,
            debitAccountId = null,
        )
        assertEquals(CaptureImportPlanner.FALLBACK_DESCRIPTION, plan.description)
    }
}
