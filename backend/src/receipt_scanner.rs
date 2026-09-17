//! NFC-e QR code parsing (Brazilian electronic invoice).
//!
//! NFC-e receipts encode their data in a URL with a URL-encoded `p` parameter.
//! The payload shape depends on the QR Code version and on whether the invoice
//! was issued online or in offline contingency mode:
//!
//! ```text
//! v1/v2 online : <access_key>|<version>|<tpAmb>|<cscId>|<hash>
//! v1/v2 offline: <access_key>|<version>|<tpAmb>|<day>|<total>|<digVal>|<cscId>|<hash>
//! v3 online    : <access_key>|3|<tpAmb>
//! v3 offline   : <access_key>|3|<tpAmb>|<day>|<total>|<tp_idDest>|<cDest>|<signature>
//! ```
//!
//! The access key contains the emitter CNPJ and the emission year/month. The
//! QR code does not contain line items, store name, or a total/date for online
//! invoices, so those values are only returned when an offline payload carries
//! them explicitly.

use anyhow::{anyhow, Result};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;

/// A parsed NFC-e QR payload.
#[derive(Debug, Clone, Deserialize)]
pub struct NfcePayload {
    /// Access key (44 digits).
    pub access_key: String,
    /// QR Code version, such as `1`, `2`, or `3`.
    pub version: String,
    /// Tax environment (`1` for production or `2` for homologation).
    pub environment: Option<String>,
    /// Invoice total, present in offline-contingency payloads.
    pub total: Option<Decimal>,
    /// Emission date (`YYYY-MM-DD`), when it can be derived from an offline payload.
    pub date: Option<String>,
    /// Emitter CNPJ derived from the access key.
    pub cnpj: Option<String>,
    /// Store corporate name is not included in the QR payload.
    pub store_name: Option<String>,
}

/// Parses a raw NFC-e QR code string into structured data.
pub fn parse_qr(qr: &str) -> Result<NfcePayload> {
    // Parse the URL query string (works even if it's not a full URL).
    let raw = qr.trim();
    let query_part = match raw.find('?') {
        Some(idx) => &raw[idx + 1..],
        None => raw,
    };

    let p = query_part
        .split('&')
        .find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            (key.trim() == "p").then_some(value)
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("NFC-e QR payload missing 'p' parameter"))?;

    // The `p` value is URL-encoded. Do not translate `+` to a space: v3
    // offline signatures are base64 and may legitimately contain `+`.
    let decoded = url_decode(p);
    let fields: Vec<&str> = decoded.split('|').map(str::trim).collect();

    let access_key = fields
        .first()
        .copied()
        .filter(|key| key.len() == 44 && key.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| {
            anyhow!("Invalid NFC-e payload: expected a 44-digit access key as the first field")
        })?;

    let version = fields
        .get(1)
        .map(|field| {
            field
                .chars()
                .filter(|character| character.is_ascii_digit())
                .take(2)
                .collect::<String>()
        })
        .unwrap_or_default();

    let environment = fields
        .get(2)
        .filter(|environment| matches!(**environment, "1" | "2"))
        .map(|environment| (*environment).to_string());

    let (total, date) = parse_offline_fields(access_key, &fields);

    Ok(NfcePayload {
        access_key: access_key.to_string(),
        version,
        environment,
        total,
        date,
        cnpj: Some(format_cnpj(&access_key[6..20])),
        store_name: None,
    })
}

/// Returns total/date only for a valid offline-contingency payload.
fn parse_offline_fields(access_key: &str, fields: &[&str]) -> (Option<Decimal>, Option<String>) {
    // tpEmis is the 35th digit of the access key (zero-based index 34). The
    // offline QR layouts carry their extra fields only when it is `9`.
    if access_key.as_bytes().get(34) != Some(&b'9') || fields.len() < 8 {
        return (None, None);
    }

    let day = fields
        .get(3)
        .and_then(|field| field.parse::<u32>().ok())
        .filter(|day| (1..=31).contains(day));
    let total = fields
        .get(4)
        .and_then(|field| Decimal::from_str_exact(field).ok());

    let date = match (day, total.is_some()) {
        (Some(day), true) => {
            let year = access_key[2..4].parse::<i32>().ok().map(|year| 2000 + year);
            let month = access_key[4..6].parse::<u32>().ok();
            year.zip(month)
                .and_then(|(year, month)| NaiveDate::from_ymd_opt(year, month, day))
                .map(|date| date.format("%Y-%m-%d").to_string())
        }
        _ => None,
    };

    (total, date)
}

/// Formats the 14-digit CNPJ stored at positions 7–20 of the access key.
fn format_cnpj(digits: &str) -> String {
    format!(
        "{}.{}.{}/{}-{}",
        &digits[0..2],
        &digits[2..5],
        &digits[5..8],
        &digits[8..12],
        &digits[12..14]
    )
}

/// Minimal URL decoder for `%XX` sequences used in NFC-e QR values.
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                out.push((high << 4) | low);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_qr;
    use rust_decimal::Decimal;

    const ONLINE_KEY: &str = "35260901735029000265650010000183261099751411";
    const OFFLINE_KEY: &str = "35240618089420122026650010000000099123456780";

    #[test]
    fn parses_real_v3_online_payload_with_three_fields() {
        let qr = format!("https://www.nfce.fazenda.sp.gov.br/qrcode?p={ONLINE_KEY}|3|1");
        let parsed = parse_qr(&qr).expect("valid NFC-e QR payload");

        assert_eq!(parsed.access_key, ONLINE_KEY);
        assert_eq!(parsed.version, "3");
        assert_eq!(parsed.environment.as_deref(), Some("1"));
        assert_eq!(parsed.cnpj.as_deref(), Some("01.735.029/0002-65"));
        assert_eq!(parsed.total, None);
        assert_eq!(parsed.date, None);
        assert_eq!(parsed.store_name, None);
    }

    #[test]
    fn parses_percent_encoded_pipe_separators() {
        let qr = format!("https://www.nfce.fazenda.sp.gov.br/qrcode?p={ONLINE_KEY}%7C3%7C1");
        let parsed = parse_qr(&qr).expect("valid NFC-e QR payload");

        assert_eq!(parsed.version, "3");
        assert_eq!(parsed.environment.as_deref(), Some("1"));
    }

    #[test]
    fn accepts_v2_online_payload_without_treating_csc_fields_as_receipt_data() {
        let qr = format!("https://example.test/qrcode?p={ONLINE_KEY}|2|2|12345|HASH");
        let parsed = parse_qr(&qr).expect("valid NFC-e QR payload");

        assert_eq!(parsed.version, "2");
        assert_eq!(parsed.environment.as_deref(), Some("2"));
        assert_eq!(parsed.total, None);
        assert_eq!(parsed.date, None);
    }

    #[test]
    fn does_not_parse_extra_online_fields_as_total_or_date() {
        let qr = format!(
            "https://example.test/qrcode?p={ONLINE_KEY}|3|1|15|42.90|1|12345678901|signature"
        );
        let parsed = parse_qr(&qr).expect("valid online NFC-e QR payload");

        assert_eq!(parsed.total, None);
        assert_eq!(parsed.date, None);
    }

    #[test]
    fn accepts_short_v2_payloads_instead_of_requiring_four_fields() {
        let qr = format!("?p={ONLINE_KEY}|2|1|HASH");
        let parsed = parse_qr(&qr).expect("valid NFC-e QR payload");

        assert_eq!(parsed.access_key, ONLINE_KEY);
        assert_eq!(parsed.version, "2");
        assert_eq!(parsed.total, None);
        assert_eq!(parsed.date, None);
    }

    #[test]
    fn parses_v2_offline_total_and_date() {
        let qr =
            format!("https://example.test/qrcode?p={OFFLINE_KEY}|2|1|15|42.90|deadbeef|12345|HASH");
        let parsed = parse_qr(&qr).expect("valid NFC-e QR payload");

        assert_eq!(parsed.version, "2");
        assert_eq!(parsed.total, Some(Decimal::new(4290, 2)));
        assert_eq!(parsed.date.as_deref(), Some("2024-06-15"));
    }

    #[test]
    fn parses_v3_offline_payload_without_corrupting_base64_signature() {
        let qr = format!("https://example.test/qrcode?p={OFFLINE_KEY}|3|2|15|42.90||cDest|abc+/==");
        let parsed = parse_qr(&qr).expect("valid NFC-e QR payload");

        assert_eq!(parsed.version, "3");
        assert_eq!(parsed.environment.as_deref(), Some("2"));
        assert_eq!(parsed.total, Some(Decimal::new(4290, 2)));
        assert_eq!(parsed.date.as_deref(), Some("2024-06-15"));
    }

    #[test]
    fn accepts_bare_query_strings_and_rejects_missing_or_invalid_keys() {
        assert!(parse_qr(&format!("p={ONLINE_KEY}|3|1")).is_ok());
        assert!(parse_qr("https://example.test/qrcode?v=3").is_err());
        assert!(parse_qr("https://example.test/qrcode?p=123").is_err());
        assert!(parse_qr(
            "https://example.test/qrcode?p=3526090173502900026565001000018326109975141A|3|1"
        )
        .is_err());
    }

    #[test]
    fn invalid_offline_date_does_not_create_a_date() {
        let qr =
            format!("https://example.test/qrcode?p={OFFLINE_KEY}|3|1|31|42.90||cDest|signature");
        let parsed = parse_qr(&qr).expect("payload key and shape are valid");

        // June has no 31st day. The amount is still a valid explicit offline
        // field, but the date must not be fabricated.
        assert_eq!(parsed.total, Some(Decimal::new(4290, 2)));
        assert_eq!(parsed.date, None);
    }

    #[test]
    fn invalid_percent_sequences_do_not_panic() {
        let qr = format!("https://example.test/qrcode?p={ONLINE_KEY}|3|1|%€|%zz");
        let parsed = parse_qr(&qr).expect("invalid percent sequences should be ignored");

        assert_eq!(parsed.version, "3");
        assert_eq!(parsed.environment.as_deref(), Some("1"));
    }
}
