//! NFC-e QR code parsing (Brazilian electronic invoice).
//!
//! NFC-e receipts encode their data in the QR code as a URL with a URL-encoded,
//! pipe-delimited `p` parameter. This module parses that payload into a
//! structured receipt, with no OCR needed.

use anyhow::{anyhow, Result};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::collections::HashMap;

/// A single line item parsed from an NFC-e QR code (best-effort).
///
/// The official NFC-e spec does not guarantee item data in the QR code. It is
/// a store/state-specific extension. When present, item fields follow the
/// header as repeating groups.
#[derive(Debug, Clone, Deserialize)]
pub struct NfceItem {
    /// Item/product description.
    pub description: String,
    /// Quantity purchased.
    pub quantity: Option<Decimal>,
    /// Unit price.
    pub unit_price: Option<Decimal>,
    /// Total price for this line.
    pub total_price: Option<Decimal>,
}

/// A parsed NFC-e QR payload.
#[derive(Debug, Clone, Deserialize)]
pub struct NfcePayload {
    /// Access key (44 digits).
    pub access_key: String,
    /// Total purchase amount.
    pub total: Decimal,
    /// Tax (ICMS) amount.
    pub icms: Decimal,
    /// Purchase date (YYYY-MM-DD or raw).
    pub date: String,
    /// Store cnpj if present.
    pub cnpj: Option<String>,
    /// Store corporate name if present.
    pub store_name: Option<String>,
    /// 2-character version field.
    pub version: String,
    /// Line items, if the QR code embedded any (may be empty).
    pub items: Vec<NfceItem>,
}

/// Parses a raw NFC-e QR code string into structured data.
///
/// The QR code is a URL such as
/// `http://www.fazenda.gov.br/nfce/qrcode?v=2&p=...`,
/// where `p` is URL-encoded and contains pipe-delimited fields
/// `[accessKey]|[version]|[icmsValue]|[totalValue]|[date]|[cnpj]|[store]`.
pub fn parse_qr(qr: &str) -> Result<NfcePayload> {
    // Parse the URL query string (works even if it's not a full URL).
    let raw = qr.trim();
    let query_part = match raw.find('?') {
        Some(idx) => &raw[idx + 1..],
        None => raw,
    };

    let params: HashMap<String, String> = query_part
        .split('&')
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let k = parts.next()?.to_string();
            let v = parts
                .next()
                .unwrap_or("")
                .replace("%3A", ":")
                .replace("%7C", "|")
                .replace("%20", " ");
            Some((k, v))
        })
        .collect();

    let p = params
        .get("p")
        .ok_or_else(|| anyhow!("NFC-e QR payload missing 'p' parameter"))?;

    // The `p` value is URL-encoded, so decode common characters.
    let decoded = url_decode(p);
    let fields: Vec<&str> = decoded.split('|').collect();

    if fields.len() < 4 {
        return Err(anyhow!(
            "Invalid NFC-e payload: expected at least 4 pipe-separated fields, got {}",
            fields.len()
        ));
    }

    let access_key = fields[0].to_string();
    let version = fields
        .get(1)
        .cloned()
        .unwrap_or("")
        .to_string()
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(2)
        .collect::<String>();

    // ICMS is field[2] (may be decimal).
    let icms = fields
        .get(2)
        .and_then(|s| Decimal::from_str_exact(s).ok())
        .unwrap_or_default();

    // Total is field[3].
    let total = fields
        .get(3)
        .and_then(|s| Decimal::from_str_exact(s).ok())
        .ok_or_else(|| anyhow!("Invalid NFC-e total value"))?;

    // Optional fields are date[4], cnpj[5], and store[6]
    let date = fields.get(4).cloned().unwrap_or_default().to_string();
    let cnpj = fields
        .get(5)
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let store_name = fields
        .get(6)
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    // Best-effort item extraction from any fields beyond the standard header.
    // Two supported shapes follow.
    //   1. A leading item count followed by N groups of 4,
    //        [count, desc1, qty1, unit1, total1, desc2, qty2, ...]
    //   2. Plain repeating groups of 4 with no count,
    //        [desc1, qty1, unit1, total1, desc2, qty2, ...]
    let items = parse_items(&fields[7.min(fields.len())..]);

    Ok(NfcePayload {
        access_key,
        total,
        icms,
        date,
        cnpj,
        store_name,
        version,
        items,
    })
}

/// Parses item groups from the fields that follow the standard NFC-e header.
fn parse_items(rest: &[&str]) -> Vec<NfceItem> {
    let rest: Vec<&str> = rest
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if rest.is_empty() {
        return Vec::new();
    }

    // Shape 1, an optional leading item count.
    let (start, count_hint) = match rest.first().and_then(|s| s.parse::<usize>().ok()) {
        Some(n) if n > 0 && rest.len() == 1 + n * 4 => (1usize, Some(n)),
        Some(n) if n > 0 && rest.len() > 1 + n * 4 => (1usize, Some(n)),
        _ => (0usize, None),
    };

    let mut items = Vec::new();
    let groups = if let Some(n) = count_hint {
        rest[start..start + n * 4]
            .chunks_exact(4)
            .collect::<Vec<_>>()
    } else if rest.len().is_multiple_of(4) {
        rest.chunks_exact(4).collect::<Vec<_>>()
    } else {
        return Vec::new();
    };

    for group in groups {
        let description = group[0].to_string();
        if description.is_empty() {
            continue;
        }
        items.push(NfceItem {
            description,
            quantity: group.get(1).and_then(|s| Decimal::from_str_exact(s).ok()),
            unit_price: group.get(2).and_then(|s| Decimal::from_str_exact(s).ok()),
            total_price: group.get(3).and_then(|s| Decimal::from_str_exact(s).ok()),
        });
    }

    items
}

/// Minimal URL decoder for `%XX` sequences used in NFC-e QR values.
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}
