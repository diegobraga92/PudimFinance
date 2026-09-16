package app.tauri.pudimnative

import java.util.Calendar
import java.util.Locale

internal data class ParsedCapture(
    val type: String,
    val amount: String,
    val description: String,
    val date: String,
    val categoryId: String?,
)

/** Kotlin counterpart of the WebView notification parser for closed-app capture. */
internal object CaptureParser {
    private val amountWithSymbol = Regex("R\\$\\s*([0-9][0-9.,]*)", RegexOption.IGNORE_CASE)
    private val amountWithWord = Regex("([0-9][0-9.,]*)\\s*(?:reais|real|brl)", RegexOption.IGNORE_CASE)
    private val expenseKeywords = listOf(
        "compra", "aprovada", "debito", "débito", "transferencia enviada",
        "transferência enviada", "pagamento efetuado", "pagamento realizado",
        "pix enviado", "pix realizado", "saque", "comprou", "cobranca",
        "cobrança", "fatura", "parcela", "boleto pago", "boleto", "cartao",
        "cartão", "conta de", "compras no cart",
    )
    private val incomeKeywords = listOf(
        "recebido", "recebida", "recebeu", "credito", "crédito", "entrada", "pix recebido",
        "pagamento recebido", "transferencia recebida", "transferência recebida",
        "deposito", "depósito", "rendimento", "estorno", "reembolso",
    )
    private val uselessDescription = Regex(
        "^(pago|paga|realizado|realizada|efetuado|efetuada|aprovado|aprovada|recebido|recebida|recebeu|compra|saque|boleto|fatura)$",
        RegexOption.IGNORE_CASE,
    )

    fun parse(body: String, fallbackCategoryId: String?): ParsedCapture? {
        val text = body.trim()
        if (text.isEmpty()) return null
        val amountMatch = amountWithSymbol.find(text) ?: amountWithWord.find(text) ?: return null
        val amount = normalizeAmount(amountMatch.groupValues[1])
        if ((amount.toDoubleOrNull() ?: 0.0) <= 0.0) return null

        val lower = text.lowercase(Locale.ROOT)
        val isIncome = incomeKeywords.any(lower::contains)
        val isExpense = expenseKeywords.any(lower::contains)
        val type = when {
            isIncome && !isExpense -> "income"
            isExpense -> "expense"
            Regex("\\bem\\b|\\bat\\b|compra", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "expense"
            else -> return null
        }

        var description = merchantDescription(text) ?: text
            .replace(Regex("R\\$\\s*[0-9][0-9.,]*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^[a-záéíóúàâêôãõçü]+ de\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^[a-záéíóúàâêôãõçü]+\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("[•·:]"), "")
            .trim()
        description = description
            .replace(Regex("\\s+às?\\s+[0-9]{1,2}[:h][0-9]{2}.*$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+para\\s+(?:o\\s+)?cart(?:a|ã)o\\b.*$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+(?:final|cartao|cartão)\\s+[0-9*]+.*$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^(?:pix\\s+)?enviado\\s+de\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^para\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^[-–—\\s]+"), "")
            .replace(Regex("[.,\\s]+$"), "")
            .trim()
            .take(80)
        if (description.length <= 3 || uselessDescription.matches(description)) {
            description = "Notificação bancária"
        }

        return ParsedCapture(type, amount, description.ifBlank { "Notificação bancária" }, today(), fallbackCategoryId)
    }

    private fun merchantDescription(text: String): String? {
        val match = Regex(
            "\\b(?:em|no|na|de|do|da)\\s+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ0-9][A-Za-zÁÉÍÓÚÀÂÊÔÃÕÇ0-9 ]{2,79}?)(?=\\s+para\\s+(?:o\\s+)?cart(?:a|ã)o\\b|\\s+às?\\s+[0-9]{1,2}[:h][0-9]{2}|[.,]|$)",
        ).find(text)
        return match?.groupValues?.getOrNull(1)?.trim()
    }

    private fun normalizeAmount(raw: String): String {
        var cleaned = raw.replace(Regex("[^0-9.,]"), "")
        cleaned = if (cleaned.contains(',') && cleaned.contains('.')) {
            cleaned.replace(".", "").replace(',', '.')
        } else {
            cleaned.replace(',', '.')
        }
        return cleaned
    }

    private fun today(): String {
        val now = Calendar.getInstance()
        return String.format(
            Locale.US,
            "%04d-%02d-%02d",
            now.get(Calendar.YEAR),
            now.get(Calendar.MONTH) + 1,
            now.get(Calendar.DAY_OF_MONTH),
        )
    }
}