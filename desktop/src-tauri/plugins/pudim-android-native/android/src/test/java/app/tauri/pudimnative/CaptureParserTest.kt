package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptureParserTest {
    @Test
    fun parsesBrazilianExpense() {
        val result = CaptureParser.parse(
            "Compra de R$ 11,77 APROVADA em DEEPSEERWEA para o cartão com final 2985.",
            null,
        )
        assertEquals("expense", result?.type)
        assertEquals("11.77", result?.amount)
        assertEquals("DEEPSEERWEA", result?.description)
    }

    @Test
    fun parsesSmokeNotificationMerchantAfterAmount() {
        val result = CaptureParser.parse(
            "Nubank Compra aprovada de R$ 23,50 em PADARIA DO ZE",
            null,
        )
        assertEquals("expense", result?.type)
        assertEquals("23.50", result?.amount)
        assertEquals("PADARIA DO ZE", result?.description)
    }

    @Test
    fun parsesReceivedPix() {
        val result = CaptureParser.parse("Você recebeu um Pix de R$ 50,00 de JOÃO SILVA", null)
        assertEquals("income", result?.type)
        assertEquals("50.00", result?.amount)
        assertEquals("JOÃO SILVA", result?.description)
    }

    @Test
    fun ignoresNonFinancialText() {
        assertNull(CaptureParser.parse("Bateria fraca, conecte o carregador", null))
    }
}