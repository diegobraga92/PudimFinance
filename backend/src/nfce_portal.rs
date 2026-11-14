//! Best-effort enrichment from public NFC-e consultation pages.

use anyhow::{anyhow, Context, Result};
use chrono::NaiveDate;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, REFERER, USER_AGENT};
use reqwest::{redirect, Url};
use rust_decimal::Decimal;
use std::sync::LazyLock;
use std::time::Duration;
use tracing::debug;

const MAX_PAGE_BYTES: u64 = 512 * 1024;
/// Backoff before each retry. The WAF drops individual requests in ~80 ms, so
/// these delays keep the common failure path short while spreading the burst.
const PORTAL_RETRY_DELAYS_MS: [u64; 4] = [250, 500, 1000, 2000];
/// One initial attempt plus one per retry delay.
const PORTAL_ATTEMPTS: usize = PORTAL_RETRY_DELAYS_MS.len() + 1;
/// The portal's WAF fingerprints the request: an honest bot UA gets connection
/// resets, and lowercase header names (what hyper writes by default) get its
/// "Request Rejected" page even with a Chrome UA. A Chrome UA plus title-case
/// headers over OpenSSL (the combination `curl` uses) is served normally, so the
/// client mirrors a browser.
const PORTAL_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

static RE_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<[^>]*>").expect("valid HTML tag regex"));
static RE_STORE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(?is)<div[^>]*id\s*=\s*["']u20["'][^>]*>(.*?)</div>"##)
        .expect("valid store regex")
});
static RE_STORE_SUFFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*:\s*\d+\s*$").expect("valid store suffix regex"));
static RE_CNPJ: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)CNPJ\s*:\s*(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{14})")
        .expect("valid CNPJ regex")
});
static RE_DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)Emiss(?:ão|ao)\s*:\s*(?:<[^>]*>\s*)*(\d{2})/(\d{2})/(\d{4})")
        .expect("valid emission date regex")
});
static RE_ITEM_ROW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(?is)<tr[^>]*id\s*=\s*["']Item\s*\+\s*\d+["'][^>]*>(.*?)</tr>"##)
        .expect("valid item row regex")
});
static RE_ITEM_DESCRIPTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(?is)<span[^>]*class\s*=\s*["'][^"']*\btxtTit\b[^"']*["'][^>]*>(.*?)</span>"##)
        .expect("valid item description regex")
});
static RE_QUANTITY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(?is)<span[^>]*class\s*=\s*["'][^"']*\bRqtd\b[^"']*["'][^>]*>(.*?)</span>"##)
        .expect("valid item quantity regex")
});
static RE_UNIT_PRICE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(?is)<span[^>]*class\s*=\s*["'][^"']*\bRvlUnit\b[^"']*["'][^>]*>(.*?)</span>"##)
        .expect("valid item unit price regex")
});
static RE_ITEM_TOTAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(?is)<span[^>]*class\s*=\s*["']valor["'][^>]*>(.*?)</span>"##)
        .expect("valid item total regex")
});
static RE_TOTAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r##"(?is)<label[^>]*>\s*Valor\s+total\s+R\$\s*:\s*</label>\s*<span[^>]*>(.*?)</span>"##,
    )
    .expect("valid total regex")
});
/// Fallback total for the compact "Consulta Resumida" page.
static RE_TOTAL_PAYABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r##"(?is)<label[^>]*>\s*Valor\s+a\s+pagar\s+R\$\s*:\s*</label>\s*<span[^>]*>(.*?)</span>"##,
    )
    .expect("valid payable total regex")
});
static RE_DISCOUNT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(?is)<label[^>]*>\s*Descontos\s+R\$\s*:\s*</label>\s*<span[^>]*>(.*?)</span>"##)
        .expect("valid discount regex")
});
static RE_NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[-+]?\d[\d.,]*").expect("valid localized number regex"));

/// Default headers sent with every portal request.
///
/// These mirror what a browser sends to the consultation page; together with the
/// title-case header names and OpenSSL TLS stack configured in the client
/// builder they pass the portal's WAF (see the `PORTAL_USER_AGENT` comment).
fn portal_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(PORTAL_USER_AGENT));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        ),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"),
    );
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://www.nfce.fazenda.sp.gov.br/"),
    );
    headers
}

static PORTAL_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 3 {
                attempt.error("too many NFC-e portal redirects")
            } else if is_allowed_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("NFC-e portal redirect target is not allowed")
            }
        }))
        .default_headers(portal_headers())
        // The WAF rejects lowercase header names (hyper's default); title-casing
        // them matches curl/browsers and is what makes the portal serve the page.
        .http1_title_case_headers()
        // Five attempts × 4 s + 3.75 s of backoff stay inside the scan
        // request budget (25 s) even if the portal hangs completely.
        .connect_timeout(Duration::from_millis(2_500))
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|error| error.to_string())
});

/// A line item extracted from a public NFC-e DANFE page.
#[derive(Debug, Clone, PartialEq)]
pub struct DanfeItem {
    /// Product description shown on the invoice.
    pub description: String,
    /// Purchased quantity, when the portal exposes a valid number.
    pub quantity: Option<Decimal>,
    /// Unit price, when the portal exposes a valid number.
    pub unit_price: Option<Decimal>,
    /// Line total, when the portal exposes a valid number.
    pub total_price: Option<Decimal>,
}

/// Fields extracted from a public NFC-e DANFE page.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DanfeDetails {
    /// Issuer/store name.
    pub store_name: Option<String>,
    /// Issuer CNPJ.
    pub cnpj: Option<String>,
    /// Emission date in ISO format.
    pub date: Option<String>,
    /// Invoice total. The full DANFE exposes a `Valor total R$` line; the
    /// compact consultation page only prints `Valor a pagar R$` (already net of
    /// discounts, which that page does not list).
    pub total: Option<Decimal>,
    /// Discount shown by the portal.
    pub discount: Option<Decimal>,
    /// Invoice line items.
    pub items: Vec<DanfeItem>,
}

/// Returns a safe public consultation URL encoded in an NFC-e QR value.
///
/// Only HTTPS URLs on a `.gov.br` host are accepted. Query-string-only values
/// are intentionally rejected because they do not identify which state portal
/// should be consulted.
pub fn consultation_url(qr: &str) -> Option<Url> {
    let mut url = Url::parse(qr.trim()).ok()?;
    if !is_allowed_url(&url) {
        return None;
    }
    rewrite_sp_qrcode_url(&mut url);
    Some(url)
}

/// Sends SP's legacy `/qrcode?p=…` URLs straight to their redirect target.
///
/// The legacy endpoint sits behind a stricter WAF rule that resets non-browser
/// clients, while the consultation page it redirects to is the same page; sending
/// the request straight there avoids the extra hop and the stricter rule.
fn rewrite_sp_qrcode_url(url: &mut Url) {
    let is_sp_portal = url.host_str().is_some_and(|host| {
        host == "www.nfce.fazenda.sp.gov.br" || host == "nfce.fazenda.sp.gov.br"
    });
    if is_sp_portal && url.path() == "/qrcode" {
        url.set_path("/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx");
    }
}

/// Fetches and parses the public DANFE page for a validated consultation URL.
///
/// The portal's edge still drops individual requests (connection resets and, on
/// rare misfires, F5 "Request Rejected" pages), so transient failures are retried
/// with a short backoff before giving up. The first parseable page wins.
pub async fn fetch_danfe(url: &Url) -> Result<DanfeDetails> {
    let mut last_error = None;

    for attempt in 0..PORTAL_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(PORTAL_RETRY_DELAYS_MS[attempt - 1])).await;
        }

        match fetch_danfe_once(url).await {
            Ok(details) => return Ok(details),
            Err(error) if !is_retryable(&error) => return Err(error),
            Err(error) => {
                debug!(
                    attempt = attempt + 1,
                    attempts = PORTAL_ATTEMPTS,
                    error = ?error,
                    "NFC-e portal attempt failed"
                );
                last_error = Some(error);
            }
        }
    }

    Err(last_error
        .expect("at least one attempt runs")
        .context(format!(
            "NFC-e portal request failed after {PORTAL_ATTEMPTS} attempts"
        )))
}

/// Performs one portal request; see [`fetch_danfe`] for the retry policy.
async fn fetch_danfe_once(url: &Url) -> Result<DanfeDetails> {
    let client = PORTAL_CLIENT
        .as_ref()
        .map_err(|error| anyhow!("could not build NFC-e portal client: {error}"))?;
    let response = client
        .get(url.clone())
        .send()
        .await
        .context("NFC-e portal request failed")?
        .error_for_status()
        .context("NFC-e portal returned an error status")?;

    if response
        .content_length()
        .is_some_and(|length| length > MAX_PAGE_BYTES)
    {
        return Err(anyhow!("NFC-e portal page is too large"));
    }

    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .context("could not read NFC-e portal response")?
    {
        if body.len() as u64 + chunk.len() as u64 > MAX_PAGE_BYTES {
            return Err(anyhow!("NFC-e portal page is too large"));
        }
        body.extend_from_slice(&chunk);
    }

    let page = String::from_utf8_lossy(&body);
    if is_waf_rejection(&page) {
        return Err(anyhow!("NFC-e portal rejected the request"));
    }

    let details = parse_danfe_html(&page);
    if details.store_name.is_none()
        && details.cnpj.is_none()
        && details.date.is_none()
        && details.total.is_none()
        && details.discount.is_none()
        && details.items.is_empty()
    {
        return Err(anyhow!(
            "NFC-e portal page contained no recognized DANFE details"
        ));
    }

    Ok(details)
}

/// True when the failure may succeed on another attempt.
fn is_retryable(error: &anyhow::Error) -> bool {
    !error
        .chain()
        .any(|cause| cause.to_string().contains("too large"))
}

/// True when the page is the F5 ASM rejection page rather than a DANFE.
fn is_waf_rejection(page: &str) -> bool {
    let lower = page.to_ascii_lowercase();
    lower.contains("request rejected") || lower.contains("requested url was rejected")
}

/// Classifies why the portal did not provide details, for `details_error`.
///
/// `blocked` covers the WAF refusing or resetting a request (its usual
/// behaviour), so the client should tell the user to try again; `timeout` means
/// the portal did not answer in time; `unavailable` covers everything else.
pub fn classify_portal_error(error: &anyhow::Error) -> &'static str {
    let mut blocked = false;
    let mut timed_out = false;

    for cause in error.chain() {
        let message = cause.to_string();
        if message.contains("too large") {
            return "too_large";
        }
        if message.contains("rejected") {
            blocked = true;
        }
        if let Some(reqwest_error) = cause.downcast_ref::<reqwest::Error>() {
            if reqwest_error.is_timeout() {
                timed_out = true;
            } else if let Some(status) = reqwest_error.status() {
                if status.as_u16() == 403 || status.as_u16() == 429 {
                    blocked = true;
                }
            } else {
                // Resets, closed connections and other transport failures: the
                // WAF drops individual requests this way, so retrying is right.
                blocked = true;
            }
        }
    }

    if blocked {
        "blocked"
    } else if timed_out {
        "timeout"
    } else {
        "unavailable"
    }
}

/// Parses the relevant fields from a public NFC-e DANFE HTML document.
///
/// The São Paulo portal uses stable semantic classes but emits legacy HTML
/// with duplicated IDs, so this parser deliberately targets those classes and
/// degrades to missing fields when the page is incomplete or changes shape.
pub fn parse_danfe_html(html: &str) -> DanfeDetails {
    let store_name = RE_STORE
        .captures(html)
        .and_then(|captures| captures.get(1))
        .map(|value| {
            let text = text_content(value.as_str());
            RE_STORE_SUFFIX.replace(&text, "").trim().to_string()
        })
        .filter(|value| !value.is_empty());
    let cnpj = RE_CNPJ
        .captures(html)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().trim().to_string());
    let date = RE_DATE.captures(html).and_then(|captures| {
        let day = captures.get(1)?.as_str().parse().ok()?;
        let month = captures.get(2)?.as_str().parse().ok()?;
        let year = captures.get(3)?.as_str().parse().ok()?;
        NaiveDate::from_ymd_opt(year, month, day).map(|date| date.format("%Y-%m-%d").to_string())
    });
    let total = extract_labeled_amount(&RE_TOTAL, html)
        .or_else(|| extract_labeled_amount(&RE_TOTAL_PAYABLE, html));
    let discount = extract_labeled_amount(&RE_DISCOUNT, html);
    let items = RE_ITEM_ROW
        .captures_iter(html)
        .filter_map(|row| parse_item(row.get(1)?.as_str()))
        .collect();

    DanfeDetails {
        store_name,
        cnpj,
        date,
        total,
        discount,
        items,
    }
}

fn is_allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| host.ends_with(".gov.br"))
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|port| port == 443)
        && url
            .query_pairs()
            .any(|(key, value)| key == "p" && !value.trim().is_empty())
}

fn parse_item(row: &str) -> Option<DanfeItem> {
    let description = first_capture(&RE_ITEM_DESCRIPTION, row).map(text_content)?;
    let description = description.trim().to_string();
    if description.is_empty() {
        return None;
    }

    Some(DanfeItem {
        description,
        quantity: first_capture(&RE_QUANTITY, row).and_then(parse_number),
        unit_price: first_capture(&RE_UNIT_PRICE, row).and_then(parse_number),
        total_price: first_capture(&RE_ITEM_TOTAL, row).and_then(parse_number),
    })
}

fn extract_labeled_amount(pattern: &Regex, html: &str) -> Option<Decimal> {
    pattern
        .captures(html)
        .and_then(|captures| captures.get(1))
        .and_then(|value| parse_number(value.as_str()))
}

fn first_capture<'a>(pattern: &Regex, value: &'a str) -> Option<&'a str> {
    pattern
        .captures(value)?
        .get(1)
        .map(|match_| match_.as_str())
}

fn parse_number(value: &str) -> Option<Decimal> {
    let text = text_content(value);
    let number = RE_NUMBER.find(&text)?.as_str();
    let normalized = if number.contains(',') {
        number.replace('.', "").replace(',', ".")
    } else {
        number.to_string()
    };
    Decimal::from_str_exact(&normalized).ok()
}

fn text_content(value: &str) -> String {
    let text = RE_TAG.replace_all(value, " ");
    text.replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{
        classify_portal_error, consultation_url, is_retryable, is_waf_rejection, parse_danfe_html,
    };
    use rust_decimal::Decimal;

    const QR_URL: &str =
        "https://www.nfce.fazenda.sp.gov.br/qrcode?p=35260901735029000265650010000183261099751411%7C3%7C1";
    /// QR code v2 URL, whose compact consultation page only lists `Valor a pagar`.
    const QR_V2_URL: &str = "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35260903476811107037650060001319331000397737%7C2%7C1%7C1%7C892bff8ee46ee9d3ce7635855e48c83c8473a5aa";
    /// QR URL from the report whose scan returned no items intermittently.
    const QR_REPORTED_URL: &str = "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261106057223049855650120000454761121917631%7C3%7C1";

    #[test]
    fn accepts_public_https_gov_br_consultation_url() {
        let url = consultation_url(QR_URL).expect("valid consultation URL");

        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("www.nfce.fazenda.sp.gov.br"));
    }

    #[test]
    fn rewrites_the_legacy_sp_qrcode_url_to_the_consultation_page() {
        let url = consultation_url(QR_URL).expect("valid consultation URL");

        assert_eq!(
            url.path(),
            "/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx"
        );
        assert_eq!(
            url.query(),
            Some("p=35260901735029000265650010000183261099751411%7C3%7C1")
        );
    }

    #[test]
    fn rejects_unsafe_or_incomplete_consultation_urls() {
        assert!(consultation_url("http://www.nfce.fazenda.sp.gov.br/qrcode?p=x").is_none());
        assert!(consultation_url("https://example.com/qrcode?p=x").is_none());
        assert!(
            consultation_url("https://user:pass@www.nfce.fazenda.sp.gov.br/qrcode?p=x").is_none()
        );
        assert!(consultation_url("https://www.nfce.fazenda.sp.gov.br:8080/qrcode?p=x").is_none());
        assert!(consultation_url("https://www.nfce.fazenda.sp.gov.br/qrcode").is_none());
        assert!(consultation_url("p=key%7C3%7C1").is_none());
    }

    #[test]
    fn parses_store_totals_date_and_items_from_danfe_html() {
        let html = r#"
            <div id="u20" class="txtTopo">MERCADO EXEMPLO LTDA:12345678000199</div>
            <div class="text">CNPJ: 12.345.678/0001-99</div>
            <table id="tabResult">
              <tr id="Item + 1">
                <td><span class="txtTit">Cafe &amp; Pao</span>
                  <span class="Rqtd"><strong>Qtde.:</strong>2</span>
                  <span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;1.234,56</span></td>
                <td class="txtTit noWrap">Vl. Total<br><span class="valor">2.469,12</span></td>
              </tr>
            </table>
            <div id="totalNota">
              <label>Qtd. total de itens:</label><span class="totalNumb">2</span>
              <label>Valor total R$:</label><span class="totalNumb">2.469,12</span>
              <label>Descontos R$:</label><span class="totalNumb">10,00</span>
              <label>Troco</label><span class="totalNumb">NaN</span>
            </div>
            <div>Emissão: 17/09/2026 13:06:32</div>
        "#;

        let parsed = parse_danfe_html(html);

        assert_eq!(parsed.store_name.as_deref(), Some("MERCADO EXEMPLO LTDA"));
        assert_eq!(parsed.cnpj.as_deref(), Some("12.345.678/0001-99"));
        assert_eq!(parsed.date.as_deref(), Some("2026-09-17"));
        assert_eq!(parsed.total, Some(Decimal::new(246912, 2)));
        assert_eq!(parsed.discount, Some(Decimal::new(1000, 2)));
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.items[0].description, "Cafe & Pao");
        assert_eq!(parsed.items[0].quantity, Some(Decimal::new(2, 0)));
        assert_eq!(parsed.items[0].unit_price, Some(Decimal::new(123456, 2)));
        assert_eq!(parsed.items[0].total_price, Some(Decimal::new(246912, 2)));
    }

    #[test]
    fn parses_the_compact_consulta_resumida_layout() {
        // The SP portal serves this shorter page for QR code v2 URLs
        // (`/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx`): it has neither
        // `Valor total R$` nor `Descontos R$`, only the net `Valor a pagar R$`.
        let html = r#"
            <div id="u20" class="txtTopo">DIA BRASIL SOCIEDADE LIMITADA</div>
            <div class="text">CNPJ: 03.476.811/1070-37</div>
            <table id="tabResult">
              <tr id="Item + 1">
                <td><span class="txtTit">LTE.SE.DE.JUSSARA 1L</span>
                  <span class="Rqtd"><strong>Qtde.:</strong>1</span>
                  <span class="RvlUnit"><strong>Vl. Unit.:</strong>5,79</span></td>
                <td class="txtTit noWrap">Vl. Total<br><span class="valor">5,79</span></td>
              </tr>
            </table>
            <div id="totalNota" class="txtRight">
              <div id="linhaTotal">
                <label>Qtd. total de itens:</label><span class="totalNumb">1</span>
              </div>
              <div id="linhaTotal" class="linhaShade">
                <label>Valor a pagar R$:</label><span class="totalNumb txtMax">72,63</span>
              </div>
              <div id="linhaTotal" class="spcTop">
                <label class="txtObs">Informação dos Tributos Totais Incidentes
                  (Lei Federal 12.741/2012) R$</label>
                <span class="totalNumb txtObs">11,54</span>
              </div>
            </div>
            <div>Emissão: </strong>25/09/2026 07:53:45</div>
        "#;

        let parsed = parse_danfe_html(html);

        assert_eq!(
            parsed.store_name.as_deref(),
            Some("DIA BRASIL SOCIEDADE LIMITADA")
        );
        assert_eq!(parsed.cnpj.as_deref(), Some("03.476.811/1070-37"));
        assert_eq!(parsed.date.as_deref(), Some("2026-09-25"));
        assert_eq!(parsed.total, Some(Decimal::new(7263, 2)));
        assert_eq!(parsed.discount, None);
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.items[0].description, "LTE.SE.DE.JUSSARA 1L");
    }

    #[test]
    fn prefers_the_full_layout_total_over_the_payable_amount() {
        // The complete DANFE lists both labels; `Valor total R$` must win so the
        // discount is not silently folded into the total.
        let html = r#"
            <div id="totalNota">
              <label>Valor total R$:</label><span class="totalNumb">78,16</span>
              <label>Descontos R$:</label><span class="totalNumb">10,35</span>
              <label>Valor a pagar R$:</label><span class="totalNumb txtMax">67,81</span>
            </div>
        "#;

        let parsed = parse_danfe_html(html);

        assert_eq!(parsed.total, Some(Decimal::new(7816, 2)));
        assert_eq!(parsed.discount, Some(Decimal::new(1035, 2)));
    }

    #[test]
    fn ignores_missing_or_invalid_danfe_sections_without_panicking() {
        let parsed = parse_danfe_html("<html><div id=\"u20\">broken");

        assert_eq!(parsed, Default::default());
    }

    #[test]
    fn recognizes_the_f5_request_rejected_page() {
        let page = r#"<html><head><title>Request Rejected</title></head>
            <body>The requested URL was rejected. Please consult with your
            administrator.<br><br>Your support ID is: 1234567890</body></html>"#;

        assert!(is_waf_rejection(page));
        assert!(!is_waf_rejection(
            "<html><div id=\"u20\">MERCADO EXEMPLO LTDA</div></html>"
        ));
    }

    #[test]
    fn retries_transient_failures_but_not_oversized_pages() {
        assert!(is_retryable(&anyhow::anyhow!(
            "NFC-e portal rejected the request"
        )));
        assert!(is_retryable(&anyhow::anyhow!(
            "NFC-e portal request failed"
        )));
        assert!(!is_retryable(&anyhow::anyhow!(
            "NFC-e portal page is too large"
        )));
    }

    #[tokio::test]
    async fn classifies_a_dropped_connection_as_blocked() {
        use reqwest::Url;
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let address = listener.local_addr().expect("listener address");
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept test connection");
            // Promise a longer body, then drop the connection mid-response: the
            // portal's WAF does the same when it resets a request.
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 64\r\n\r\npartial")
                .await;
            drop(stream);
        });

        let url = Url::parse(&format!("http://{address}/")).expect("valid test URL");
        let error = super::fetch_danfe_once(&url)
            .await
            .expect_err("the dropped connection must fail");

        assert_eq!(classify_portal_error(&error), "blocked");
    }

    #[test]
    fn classifies_terminal_portal_failures_for_the_scan_response() {
        assert_eq!(
            classify_portal_error(&anyhow::anyhow!("NFC-e portal rejected the request")),
            "blocked"
        );
        assert_eq!(
            classify_portal_error(&anyhow::anyhow!("NFC-e portal page is too large")),
            "too_large"
        );
        assert_eq!(
            classify_portal_error(&anyhow::anyhow!(
                "NFC-e portal page contained no recognized DANFE details"
            )),
            "unavailable"
        );
    }

    #[tokio::test]
    #[ignore = "requires the live NFC-e portal; run with NFCE_LIVE=1"]
    async fn parses_the_live_sp_portal_page() {
        if std::env::var("NFCE_LIVE").ok().as_deref() != Some("1") {
            return;
        }

        let url = consultation_url(QR_URL).expect("valid consultation URL");
        let parsed = super::fetch_danfe(&url).await.expect("portal response");

        assert_eq!(
            parsed.store_name.as_deref(),
            Some("BLUES BROTHER S MASSAS LTDA")
        );
        assert_eq!(parsed.cnpj.as_deref(), Some("01.735.029/0002-65"));
        assert_eq!(parsed.date.as_deref(), Some("2026-09-17"));
        assert_eq!(parsed.total, Some(Decimal::new(7816, 2)));
        assert_eq!(parsed.discount, Some(Decimal::new(1035, 2)));
        assert_eq!(parsed.items.len(), 2);
        assert_eq!(parsed.items[0].description, "CMB1 MS A MODA DA CANTINA");
        assert_eq!(parsed.items[1].description, "Entrega");
    }

    #[tokio::test]
    #[ignore = "requires the live NFC-e portal; run with NFCE_LIVE=1"]
    async fn parses_the_live_sp_compact_portal_page() {
        if std::env::var("NFCE_LIVE").ok().as_deref() != Some("1") {
            return;
        }

        let url = consultation_url(QR_V2_URL).expect("valid consultation URL");
        let parsed = super::fetch_danfe(&url).await.expect("portal response");

        assert_eq!(
            parsed.store_name.as_deref(),
            Some("DIA BRASIL SOCIEDADE LIMITADA")
        );
        assert_eq!(parsed.cnpj.as_deref(), Some("03.476.811/1070-37"));
        assert_eq!(parsed.date.as_deref(), Some("2026-09-25"));
        assert_eq!(parsed.total, Some(Decimal::new(7263, 2)));
        assert_eq!(parsed.items.len(), 9);
    }

    #[tokio::test]
    #[ignore = "requires the live NFC-e portal; run with NFCE_LIVE=1"]
    async fn parses_the_reported_sp_portal_page_through_the_retry_loop() {
        if std::env::var("NFCE_LIVE").ok().as_deref() != Some("1") {
            return;
        }

        let url = consultation_url(QR_REPORTED_URL).expect("valid consultation URL");
        let parsed = super::fetch_danfe(&url).await.expect("portal response");

        assert_eq!(
            parsed.store_name.as_deref(),
            Some("SENDAS DISTRIBUIDORA S/A")
        );
        assert_eq!(parsed.cnpj.as_deref(), Some("06.057.223/0498-55"));
        assert_eq!(parsed.date.as_deref(), Some("2026-11-14"));
        assert_eq!(parsed.total, Some(Decimal::new(119337, 2)));
        assert_eq!(parsed.discount, Some(Decimal::new(3020, 2)));
        assert_eq!(parsed.items.len(), 86);
    }
}
