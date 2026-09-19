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
    fun creditActionUsesTheCreditAccount() {
        val plan = CaptureImportPlanner.planForAction(
            CapturePromptNotifier.ACTION_CREDIT,
            parsed,
            defaultCategoryId = "cat-default",
            debitAccountId = "acc-debit",
            creditAccountId = "acc-credit",
        )
        assertEquals("expense", plan?.type)
        assertEquals("acc-credit", plan?.accountId)
        assertEquals("cat-default", plan?.categoryId)
        assertEquals("11.77", plan?.amount)
        assertEquals("DEEPSEERWEA", plan?.description)
        assertEquals("2026-09-19", plan?.date)
    }

    @Test
    fun debitActionUsesTheDebitAccount() {
        val plan = CaptureImportPlanner.planForAction(
            CapturePromptNotifier.ACTION_DEBIT,
            parsed,
            defaultCategoryId = null,
            debitAccountId = "acc-debit",
            creditAccountId = "acc-credit",
        )
        assertEquals("expense", plan?.type)
        assertEquals("acc-debit", plan?.accountId)
    }

    @Test
    fun incomeActionCreatesIncomeWithoutAnAccount() {
        val plan = CaptureImportPlanner.planForAction(
            CapturePromptNotifier.ACTION_INCOME,
            parsed,
            defaultCategoryId = "cat-default",
            debitAccountId = "acc-debit",
            creditAccountId = "acc-credit",
        )
        assertEquals("income", plan?.type)
        assertNull(plan?.accountId)
        // Income must not borrow the expense default category.
        assertNull(plan?.categoryId)
    }

    @Test
    fun unknownActionIsRejected() {
        assertNull(
            CaptureImportPlanner.planForAction(
                "transfer",
                parsed,
                defaultCategoryId = null,
                debitAccountId = null,
                creditAccountId = null,
            ),
        )
    }

    @Test
    fun parsedCategoryWinsOverTheDefault() {
        val plan = CaptureImportPlanner.planForAction(
            CapturePromptNotifier.ACTION_CREDIT,
            parsed.copy(categoryId = "cat-guessed"),
            defaultCategoryId = "cat-default",
            debitAccountId = null,
            creditAccountId = null,
        )
        assertEquals("cat-guessed", plan?.categoryId)
    }

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
        assertNull(plan.categoryId)
    }

    @Test
    fun blankDescriptionsFallBackToTheGenericLabel() {
        val plan = CaptureImportPlanner.planForAction(
            CapturePromptNotifier.ACTION_CREDIT,
            parsed.copy(description = ""),
            defaultCategoryId = null,
            debitAccountId = null,
            creditAccountId = null,
        )
        assertEquals(CaptureImportPlanner.FALLBACK_DESCRIPTION, plan?.description)
    }
}
