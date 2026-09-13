//! Bank statement parsing for reconciliation.
//!
//! Supports CSV files (with delimiter/column auto-detection) and OFX 1.x/2.x
//! statement files (SGML/XML). Both produce a uniform `Vec<StatementLine>`.

use anyhow::{anyhow, Result};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::collections::HashMap;

use crate::models::StatementLine;

/// Statement file format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementFormat {
    /// Comma/semicolon separated values with date/description/amount columns.
    Csv,
    /// Open Financial Exchange (SGML/XML).
    Ofx,
}

/// Detects the format from the raw content.
pub fn detect_format(raw: &str) -> StatementFormat {
    let trimmed = raw.trim_start();
    if trimmed.starts_with("<OFX") || trimmed.to_uppercase().contains("<OFX>") {
        StatementFormat::Ofx
    } else {
        StatementFormat::Csv
    }
}

/// Parses raw statement content into uniform statement lines.
pub fn parse_statement(raw: &str, format: StatementFormat) -> Result<Vec<StatementLine>> {
    match format {
        StatementFormat::Csv => parse_csv(raw),
        StatementFormat::Ofx => parse_ofx(raw),
    }
}

// CSV parsing

/// Parses a CSV statement, locating date/description/amount columns by header name.
fn parse_csv(raw: &str) -> Result<Vec<StatementLine>> {
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(raw.as_bytes());

    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| anyhow!("Invalid CSV header: {}", e))?
        .iter()
        .map(|h| h.to_lowercase())
        .collect();

    if headers.is_empty() {
        return Err(anyhow!("CSV has no header row"));
    }

    // Locate columns by common header names (en and pt-BR).
    let find_col = |names: &[&str]| headers.iter().position(|h| names.contains(&h.as_str()));

    let date_col = find_col(&[
        "date",
        "data",
        "data_lancamento",
        "date_lancamento",
        "data pagamento",
        "data_pagamento",
    ])
    .ok_or_else(|| anyhow!("CSV is missing a date column"))?;

    let desc_col = find_col(&[
        "description",
        "descricao",
        "descrição",
        "memo",
        "historico",
        "histórico",
        "lançamento",
        "lancamento",
        "estabelecimento",
        "favorito",
    ])
    .ok_or_else(|| anyhow!("CSV is missing a description column"))?;

    let amount_col = find_col(&[
        "amount",
        "valor",
        "value",
        "saldo_lancamento",
        "valor_lancamento",
        "lancto",
    ])
    .ok_or_else(|| anyhow!("CSV is missing an amount column"))?;

    let mut lines = Vec::new();
    for record in rdr.records() {
        let record = record.map_err(|e| anyhow!("Invalid CSV row: {}", e))?;
        let get = |idx: usize| record.get(idx).unwrap_or("").trim().to_string();

        let date_raw = get(date_col);
        let description = get(desc_col);
        let amount_raw = get(amount_col);

        if description.is_empty() && amount_raw.is_empty() {
            continue;
        }

        let date = parse_date(&date_raw)?;
        let amount = parse_br_amount(&amount_raw)?;
        lines.push(StatementLine {
            date,
            description: description.clone(),
            amount,
        });
    }

    if lines.is_empty() {
        return Err(anyhow!("CSV contained no parseable transaction rows"));
    }

    Ok(lines)
}

// OFX parsing

/// Parses an OFX statement file. Handles both SGML (no quotes, no closing tags)
/// and XML (quoted attributes) variants. Extracts every `<STMTTRN>` block.
fn parse_ofx(raw: &str) -> Result<Vec<StatementLine>> {
    let text = strip_ofx_headers(raw);

    let mut lines = Vec::new();
    // Split on STMTTRN blocks. Each must contain DTPOSTED and TRNAMT.
    for block in text.split("<STMTTRN>").skip(1) {
        let block = block.split("</STMTTRN>").next().unwrap_or(block);
        let tags = extract_tags(block);

        let amount = match tags.get("TRNAMT") {
            Some(v) => parse_br_amount(v)?,
            None => continue,
        };
        let date = match tags.get("DTPOSTED").or_else(|| tags.get("DTUSER")) {
            Some(v) => parse_ofx_date(v)?,
            None => continue,
        };
        let description = tags
            .get("MEMO")
            .or_else(|| tags.get("NAME"))
            .or_else(|| tags.get("PAYEE"))
            .cloned()
            .unwrap_or_default();

        lines.push(StatementLine {
            date,
            description,
            amount,
        });
    }

    if lines.is_empty() {
        return Err(anyhow!("OFX file contained no STMTTRN transactions"));
    }

    Ok(lines)
}

/// Removes OFX `<?xml ... ?>` / `<?OFX ... ?>` prologs and leading garbage.
fn strip_ofx_headers(raw: &str) -> String {
    let mut text = raw.to_string();
    // Remove XML/SGML processing instructions.
    while let Some(start) = text.find("<?") {
        if let Some(end) = text[start..].find("?>") {
            let end = start + end + 2;
            text.replace_range(start..end, " ");
        } else {
            break;
        }
    }
    text
}

/// Extracts all `TAG VALUE` pairs from a block into a map (first value wins).
fn extract_tags(block: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut rest = block;
    while let Some(lt) = rest.find('<') {
        let after = &rest[lt + 1..];
        let Some(gt) = after.find('>') else { break };
        let tag = after[..gt].trim().to_uppercase();
        let value_rest = &after[gt + 1..];

        // Value runs until the next '<' or the end.
        let value = match value_rest.find('<') {
            Some(next) => &value_rest[..next],
            None => value_rest,
        };
        let value = value.trim().to_string();

        map.entry(tag).or_insert(value);
        rest = value_rest;
    }
    map
}

/// Parses an OFX date in the `YYYYMMDDHHMMSS[.XXX]` or `YYYYMMDD` form.
fn parse_ofx_date(raw: &str) -> Result<NaiveDate> {
    let clean: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(8)
        .collect();
    if clean.len() < 8 {
        return Err(anyhow!("Invalid OFX date: {}", raw));
    }
    NaiveDate::parse_from_str(&clean, "%Y%m%d").map_err(|_| anyhow!("Invalid OFX date: {}", raw))
}

// Shared value parsers

/// Parses an amount that may be in Brazilian format (`1.234,56`), US format
/// (`1,234.56`), or plain (`-49.90`). Returns a signed value.
fn parse_br_amount(raw: &str) -> Result<Decimal> {
    let mut s = raw.trim().to_string();
    // Strip currency symbols/prefixes.
    s = s
        .replace("R$", "")
        .replace("r$", "")
        .replace("USD", "")
        .replace('$', "")
        .trim()
        .to_string();

    // Parentheses mean negative (accounting style).
    let negative = s.starts_with('(') && s.ends_with(')');
    if negative {
        s = s[1..s.len() - 1].to_string();
    }

    let has_comma = s.contains(',');
    let has_dot = s.contains('.');
    if has_comma && has_dot {
        // Whichever comes LAST is the decimal separator (common BR style).
        if s.rfind(',') > s.rfind('.') {
            // Brazilian style uses dots as thousands and a comma as decimal.
            s = s.replace('.', "").replace(',', ".");
        } else {
            // US style uses a comma as thousands and a dot as decimal.
            s = s.replace(',', "");
        }
    } else if has_comma {
        // Single comma. Could be BR decimal or US thousands.
        let after = s.split(',').nth(1).unwrap_or("");
        if after.len() <= 2 {
            s = s.replace(',', ".");
        } else {
            s = s.replace(',', "");
        }
    } else if has_dot {
        // Single dot. Could be US decimal or BR thousands.
        let after = s.split('.').nth(1).unwrap_or("");
        if after.len() == 3 {
            s = s.replace('.', "");
        }
        // otherwise leave as-is (decimal dot).
    }

    let dec: Decimal = s.parse().map_err(|_| anyhow!("Invalid amount: {}", raw))?;
    Ok(if negative { -dec } else { dec })
}

/// Parses dates in `YYYY-MM-DD`, `DD/MM/YYYY`, or `DD-MM-YYYY` formats.
fn parse_date(raw: &str) -> Result<NaiveDate> {
    let raw = raw.trim().to_string();
    let raw = raw.split([' ', 'T']).next().unwrap_or(&raw).to_string();

    if raw.contains('-') && raw.len() >= 10 {
        // ISO-like date. Check that the first character is a digit of a 4-digit year.
        let parts: Vec<&str> = raw.split('-').collect();
        if parts.len() == 3 && parts[0].len() == 4 {
            return NaiveDate::parse_from_str(&raw, "%Y-%m-%d")
                .map_err(|_| anyhow!("Invalid date: {}", raw));
        }
        return NaiveDate::parse_from_str(&raw, "%d-%m-%Y")
            .map_err(|_| anyhow!("Invalid date: {}", raw));
    }
    if raw.contains('/') {
        let parts: Vec<&str> = raw.split('/').collect();
        if parts.len() == 3 && parts[2].len() == 4 {
            return NaiveDate::parse_from_str(&raw, "%d/%m/%Y")
                .map_err(|_| anyhow!("Invalid date: {}", raw));
        }
    }
    NaiveDate::parse_from_str(&raw, "%Y-%m-%d").map_err(|_| anyhow!("Invalid date: {}", raw))
}
