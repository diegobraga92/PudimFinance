//! Parses OCR text into a reviewable receipt.

use regex::Regex;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::sync::LazyLock;

/// A single line item parsed from OCR text (best-effort).
#[derive(Debug, Clone, Deserialize)]
pub struct ReceiptOcrItem {
    /// Item/product description.
    pub description: String,
    /// Quantity purchased.
    pub quantity: Option<Decimal>,
    /// Unit price.
    pub unit_price: Option<Decimal>,
    /// Total price for this line.
    pub total_price: Option<Decimal>,
}

/// A parsed receipt extracted from raw OCR text.
#[derive(Debug, Clone, Deserialize)]
pub struct ReceiptOcrResult {
    /// 44-digit access key if found.
    pub access_key: Option<String>,
    /// Store CNPJ if found.
    pub cnpj: Option<String>,
    /// Purchase date (ISO `YYYY-MM-DD`) if found.
    pub date: Option<String>,
    /// Total purchase amount if found.
    pub total: Option<Decimal>,
    /// Store name if found.
    pub store_name: Option<String>,
    /// Line items, best-effort (may be empty).
    pub items: Vec<ReceiptOcrItem>,
}

static RE_ACCESS_KEY: LazyLock<Regex> = LazyLock::new(|| {
    // 11 groups of 4 digits, optionally separated by space/dot/dash.
    Regex::new(r"(?:[0-9]{4}[\s.\-]?){10}[0-9]{4}").unwrap()
});
static RE_CNPJ_LABELED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)cnpj[:.\s]*(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{14})").unwrap()
});
static RE_CNPJ_BARE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}").unwrap());
static RE_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d{2}/\d{2}/\d{4}").unwrap());
static RE_QTY_UNIT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"([\d.,]+)\s*[xX×]\s*([\d.,]+)").unwrap());
static RE_LEADING_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*\d{1,6}\s+").unwrap());
static RE_TRAILING_AMOUNT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"([\d.,]+)\s*$").unwrap());

/// Parses raw OCR text into a structured receipt.
pub fn parse_receipt_text(raw: &str) -> ReceiptOcrResult {
    let lines: Vec<&str> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    let text = lines.join("\n");

    ReceiptOcrResult {
        access_key: extract_access_key(&text),
        cnpj: extract_cnpj(&text),
        date: extract_date(&text).map(|d| iso_date(&d)),
        total: extract_total(&lines),
        store_name: extract_store_name(&lines),
        items: extract_items(&lines),
    }
}

/// Extracts the 44-digit NFC-e access key.
fn extract_access_key(text: &str) -> Option<String> {
    // Prefer the grouped presentation (11 groups of 4).
    if let Some(m) = RE_ACCESS_KEY.find(text) {
        let key: String = m.as_str().chars().filter(|c| c.is_ascii_digit()).collect();
        if key.len() >= 44 {
            return Some(key[..44].to_string());
        }
    }
    // Otherwise look right after the "chave de acesso" label.
    if let Some(idx) = text.to_lowercase().find("chave de acesso") {
        let digits: String = text[idx..].chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 44 {
            return Some(digits[..44].to_string());
        }
    }
    None
}

/// Extracts the store CNPJ (labeled or bare).
fn extract_cnpj(text: &str) -> Option<String> {
    if let Some(caps) = RE_CNPJ_LABELED.captures(text) {
        return Some(caps[1].to_string());
    }
    if let Some(m) = RE_CNPJ_BARE.find(text) {
        return Some(m.as_str().to_string());
    }
    None
}

/// Extracts the first `dd/mm/yyyy` date.
fn extract_date(text: &str) -> Option<String> {
    RE_DATE.find(text).map(|m| m.as_str().to_string())
}

/// Converts `dd/mm/yyyy` to ISO `yyyy-mm-dd`.
fn iso_date(dmy: &str) -> String {
    let parts: Vec<&str> = dmy.split('/').collect();
    if parts.len() == 3 {
        format!("{}-{}-{}", parts[2], parts[1], parts[0])
    } else {
        dmy.to_string()
    }
}

/// Extracts the total from a line containing "TOTAL".
fn extract_total(lines: &[&str]) -> Option<Decimal> {
    for line in lines {
        let upper = line.to_uppercase();
        if upper.contains("TOTAL") && !upper.contains("ITENS") && !upper.contains("PRODUTOS") {
            if let Some(amount) = last_amount(line) {
                return Some(amount);
            }
        }
    }
    None
}

/// Extracts the store name from the first meaningful line.
fn extract_store_name(lines: &[&str]) -> Option<String> {
    for line in lines {
        let upper = line.to_uppercase();
        // Skip lines that are clearly not the store name.
        let skip = line.chars().all(|c| !c.is_alphabetic())
            || upper.contains("CNPJ")
            || upper.contains("DANFE")
            || upper.contains("NFC-E")
            || upper.contains("DOCUMENTO")
            || upper.contains("CONSUMIDOR")
            || upper.contains("ENDERECO")
            || upper.contains("CHAVE DE ACESSO")
            || upper.contains("PROTOCOLO")
            || upper.contains("EMISSAO")
            || upper.contains("HORA")
            || upper.starts_with("WWW");
        if skip {
            continue;
        }
        // Trim leading non-alphanumeric artifacts and cap the length.
        let cleaned = line
            .split_whitespace()
            .take(6)
            .collect::<Vec<_>>()
            .join(" ");
        if cleaned.chars().filter(|c| c.is_alphanumeric()).count() >= 3 {
            return Some(cleaned);
        }
    }
    None
}

/// Best-effort item extraction from the body of the receipt.
///
/// Lines that are not header/footer and that end in a plausible monetary amount
/// are treated as item lines. The trailing amount is the line total, and a
/// `qty x unit` segment, when present, is split out. Because OCR text is noisy,
/// the UI always allows review.
fn extract_items(lines: &[&str]) -> Vec<ReceiptOcrItem> {
    let mut items = Vec::new();
    for line in lines {
        let upper = line.to_uppercase();
        // Skip obvious non-item lines.
        let is_noise = upper.contains("CNPJ")
            || upper.contains("TOTAL")
            || upper.contains("CHAVE DE ACESSO")
            || upper.contains("PROTOCOLO")
            || upper.contains("CONSUMIDOR")
            || upper.contains("ENDERECO")
            || upper.contains("EMISSAO")
            || upper.contains("NFC-E")
            || upper.contains("DANFE")
            || upper.contains("DESCONTO")
            || upper.contains("TROCO")
            || upper.contains("CUPOM")
            || upper.contains("SUBTOTAL")
            || upper.contains("ICMS")
            || upper.contains("PAGAMENTO")
            || upper.contains("DINHEIRO")
            || upper.contains("CARTAO")
            || upper.contains("CREDITO")
            || upper.contains("DEBITO")
            || upper.contains("PIX");
        if is_noise {
            continue;
        }

        // The trailing amount is the line total.
        let Some(m) = RE_TRAILING_AMOUNT.find(line) else {
            continue;
        };
        let Some(total_price) = parse_decimal(m.as_str()) else {
            continue;
        };
        if total_price <= Decimal::ZERO {
            continue;
        }
        let before = &line[..m.start()];

        // A "qty x unit" segment may precede the total.
        let (quantity, unit_price, desc_raw) = if let Some(qc) = RE_QTY_UNIT.captures(before) {
            let q = parse_decimal(&qc[1]);
            let u = parse_decimal(&qc[2]);
            let desc = before[..qc.get(0).unwrap().start()].trim().to_string();
            (q, u, desc)
        } else {
            (None, None, before.trim().to_string())
        };

        // Strip a leading numeric product code.
        let description = RE_LEADING_CODE.replace(&desc_raw, "").trim().to_string();
        if description.len() < 2 || description.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }

        items.push(ReceiptOcrItem {
            description,
            quantity,
            unit_price,
            total_price: Some(total_price),
        });
    }
    items
}

/// Parses a Brazilian-style decimal (`1.234,56` or `1,00`).
fn parse_decimal(s: &str) -> Option<Decimal> {
    let mut cleaned = s.trim().to_string();
    let has_comma = cleaned.contains(',');
    let has_dot = cleaned.contains('.');
    if has_comma && has_dot {
        if cleaned.rfind(',') > cleaned.rfind('.') {
            cleaned = cleaned.replace('.', "").replace(',', ".");
        } else {
            cleaned = cleaned.replace(',', "");
        }
    } else if has_comma {
        cleaned = cleaned.replace(',', ".");
    }
    cleaned.parse().ok()
}

/// Finds the last monetary amount on a line (`R$ 123,45` / `123,45`).
fn last_amount(line: &str) -> Option<Decimal> {
    let m = RE_TRAILING_AMOUNT.find(line)?;
    let token = m.as_str();
    // A total amount must contain a comma (Brazilian decimal) or a dot.
    if token.contains(',') || token.contains('.') {
        parse_decimal(token)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
SUPERMERCADO BOM PRECO LTDA
CNPJ: 12.345.678/0001-90
RUA DAS FLORES, 123 - CENTRO

CUPOM FISCAL
001 ARROZ 5KG        25,90
002 FEIJAO 1KG       2 x 4,25        8,50
003 LEITE 1L         6,90

TOTAL R$ 41,30
FORMAS DE PAGAMENTO
DINHEIRO 41,30

CHAVE DE ACESSO 3525 0618 0894 2012 2026 1000 1234 5678 9012 3456 7890
PROTOCOLO DE AUTORIZACAO
EMISSAO: 12/08/2026 15:30:00
"#;

    #[test]
    fn parses_access_key() {
        let r = parse_receipt_text(SAMPLE);
        let key = r.access_key.expect("access key");
        assert_eq!(key.len(), 44);
        assert!(key.starts_with("35250618089420122026"));
    }

    #[test]
    fn parses_cnpj() {
        let r = parse_receipt_text(SAMPLE);
        assert_eq!(r.cnpj.as_deref(), Some("12.345.678/0001-90"));
    }

    #[test]
    fn parses_date() {
        let r = parse_receipt_text(SAMPLE);
        assert_eq!(r.date.as_deref(), Some("2026-08-12"));
    }

    #[test]
    fn parses_total() {
        let r = parse_receipt_text(SAMPLE);
        assert_eq!(r.total, Some(Decimal::new(4130, 2)));
    }

    #[test]
    fn parses_store_name() {
        let r = parse_receipt_text(SAMPLE);
        assert!(r.store_name.as_deref().unwrap_or("").contains("BOM PRECO"));
    }

    #[test]
    fn parses_items() {
        let r = parse_receipt_text(SAMPLE);
        assert_eq!(r.items.len(), 3);
        assert_eq!(r.items[0].description, "ARROZ 5KG");
        assert_eq!(r.items[0].total_price, Some(Decimal::new(2590, 2)));
        assert_eq!(r.items[1].quantity, Some(Decimal::new(2, 0)));
        assert_eq!(r.items[1].unit_price, Some(Decimal::new(425, 2)));
        assert_eq!(r.items[1].total_price, Some(Decimal::new(850, 2)));
    }
}
