//! Receipt scanning and price-tracking endpoints.
//!
//! Uses the NFC-e QR parser (no OCR) to turn a QR code string into a receipt,
//! persists receipts and items, and exposes price history and product merging.

#![allow(clippy::result_large_err)]

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use sqlx::AssertSqlSafe;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    ReceiptDetail, ReceiptItemDetail, ReceiptListResponse, ReceiptStats, ReceiptSummary,
    SaveReceiptBody, UpdateReceiptItemRequest,
};
use crate::receipt_ocr;
use crate::receipt_scanner;
use crate::state::AppState;

/// Request payload for scanning a raw NFC-e QR code.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ScanRequest {
    /// Raw QR code content (URL or `p=` payload).
    pub qr_data: String,
}

/// Request payload for parsing raw OCR text from a receipt photo.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct OcrRequest {
    /// Raw text extracted by the OCR engine (ML Kit / tesseract.js).
    pub raw_text: String,
}

/// Query params for the receipt list.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ReceiptListParams {
    /// Matches the store name or any item description.
    pub search: Option<String>,
    /// Restrict to one store.
    pub store_id: Option<Uuid>,
    /// Inclusive lower bound on the receipt date (`YYYY-MM-DD`).
    pub from: Option<NaiveDate>,
    /// Exclusive upper bound on the receipt date (`YYYY-MM-DD`).
    pub to: Option<NaiveDate>,
    /// Minimum receipt total.
    pub min_total: Option<Decimal>,
    /// Maximum receipt total.
    pub max_total: Option<Decimal>,
    /// `nfce` or `ocr`.
    pub source: Option<String>,
    /// Page offset (default 0).
    pub page: Option<u32>,
    /// Page size (default 50, max 200).
    pub page_size: Option<u32>,
}

/// Query params for price history.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PriceHistoryParams {
    /// Normalized product ID.
    pub product_id: Uuid,
    /// Months of history (default 6).
    pub months: Option<i32>,
}

/// Query params for the overview statistics.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ReceiptStatsParams {
    /// Month to report on, `YYYY-MM` (default: the current month).
    pub month: Option<String>,
}

/// Request payload for merging two normalized products.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct MergeProductsRequest {
    /// Product to keep.
    pub target_id: Uuid,
    /// Product to merge into target (will be deleted).
    pub source_id: Uuid,
}

/// Receipt sub-router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/receipts/scan", axum::routing::post(scan))
        .route("/api/receipts/ocr", axum::routing::post(ocr))
        .route("/api/receipts/stats", axum::routing::get(receipt_stats))
        .route(
            "/api/receipts",
            axum::routing::get(list_receipts).post(save_receipt),
        )
        .route(
            "/api/receipts/{id}",
            axum::routing::get(get_receipt).delete(delete_receipt),
        )
        .route(
            "/api/receipts/{id}/items/{item_id}",
            axum::routing::put(update_receipt_item).delete(delete_receipt_item),
        )
        .route(
            "/api/receipts/price-history",
            axum::routing::get(price_history),
        )
        .route(
            "/api/receipts/product/merge",
            axum::routing::post(merge_products),
        )
}

/// Finds the store row for `(name, cnpj)`, creating it when needed.
///
/// Stores are deduplicated: by CNPJ when one is known, otherwise by name. The
/// partial unique indexes from migration 014 make this idempotent even if two
/// saves race.
async fn resolve_store(
    pool: &sqlx::PgPool,
    name: &str,
    cnpj: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    let existing: Option<Uuid> = match cnpj {
        Some(cnpj) => {
            sqlx::query_scalar("SELECT id FROM stores WHERE cnpj = $1")
                .bind(cnpj)
                .fetch_optional(pool)
                .await?
        }
        None => {
            sqlx::query_scalar("SELECT id FROM stores WHERE lower(name) = lower($1) LIMIT 1")
                .bind(name)
                .fetch_optional(pool)
                .await?
        }
    };

    if let Some(id) = existing {
        return Ok(id);
    }

    let id = Uuid::new_v4();
    let insert = sqlx::query("INSERT INTO stores (id, name, cnpj) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(name)
        .bind(cnpj)
        .execute(pool)
        .await;

    match insert {
        Ok(_) => Ok(id),
        Err(e) => {
            // Lost a race against a concurrent insert: the unique index rejected
            // this row, so reuse the winner instead of failing the receipt.
            let winner: Option<Uuid> = match cnpj {
                Some(cnpj) => {
                    sqlx::query_scalar("SELECT id FROM stores WHERE cnpj = $1")
                        .bind(cnpj)
                        .fetch_optional(pool)
                        .await?
                }
                None => {
                    sqlx::query_scalar(
                        "SELECT id FROM stores WHERE lower(name) = lower($1) LIMIT 1",
                    )
                    .bind(name)
                    .fetch_optional(pool)
                    .await?
                }
            };
            winner.ok_or(e)
        }
    }
}

/// Recomputes a receipt's total from its items, so a stored total never drifts
/// from the items the receipt actually contains.
async fn refresh_receipt_total(pool: &sqlx::PgPool, receipt_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE receipts
         SET total_amount = COALESCE(
                 (SELECT SUM(COALESCE(ri.total_price, ri.unit_price * ri.quantity))
                  FROM receipt_items ri
                  WHERE ri.receipt_id = $1),
                 0
             )
         WHERE id = $1",
    )
    .bind(receipt_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Upserts a normalized product for an item description and returns its id.
///
/// The backend owns product identity (and the merge endpoint can repair it
/// later); the client never invents products.
async fn upsert_product(pool: &sqlx::PgPool, description: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query(
        "INSERT INTO normalized_products (id, name)
         VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name",
    )
    .bind(Uuid::new_v4())
    .bind(description)
    .execute(pool)
    .await?;

    sqlx::query_scalar("SELECT id FROM normalized_products WHERE name = $1")
        .bind(description)
        .fetch_one(pool)
        .await
}

/// Scans a raw NFC-e QR code and returns the parsed receipt preview.
#[utoipa::path(
    post,
    path = "/api/receipts/scan",
    tag = "Receipts",
    request_body = ScanRequest,
    responses(
        (status = 200, description = "Parsed receipt preview"),
        (status = 400, description = "Invalid QR data"),
    ),
)]
pub async fn scan(
    Json(payload): Json<ScanRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let parsed = receipt_scanner::parse_qr(&payload.qr_data).map_err(|e| {
        error!("QR parse failed: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Invalid NFC-e QR code: {}", e) })),
        )
    })?;

    Ok(Json(json!({
        "access_key": parsed.access_key,
        "total": parsed.total.map(|total| total.to_string()),
        "date": parsed.date,
        "cnpj": parsed.cnpj,
        "store_name": parsed.store_name,
        "version": parsed.version,
        "environment": parsed.environment,
        "items": [],
    })))
}

/// Parses raw OCR text from a receipt photo into structured data.
///
/// The OCR engine runs on the client (ML Kit on mobile, tesseract.js on web).
/// This endpoint turns the resulting text into the same structured shape the
/// QR scan returns, so the save/review flow is identical for both sources.
#[utoipa::path(
    post,
    path = "/api/receipts/ocr",
    tag = "Receipts",
    request_body = OcrRequest,
    responses(
        (status = 200, description = "Parsed receipt from OCR text"),
        (status = 400, description = "Empty OCR text"),
    ),
)]
pub async fn ocr(
    Json(payload): Json<OcrRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if payload.raw_text.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "raw_text must not be empty" })),
        ));
    }

    let parsed = receipt_ocr::parse_receipt_text(&payload.raw_text);

    Ok(Json(json!({
        "access_key": parsed.access_key,
        "total": parsed.total.map(|t| t.to_string()),
        "date": parsed.date,
        "cnpj": parsed.cnpj,
        "store_name": parsed.store_name,
        "items": parsed.items.iter().map(|i| {
            json!({
                "description": i.description,
                "quantity": i.quantity.map(|q| q.to_string()),
                "unit_price": i.unit_price.map(|p| p.to_string()),
                "total_price": i.total_price.map(|p| p.to_string()),
            })
        }).collect::<Vec<_>>(),
    })))
}

/// Saves a reviewed receipt (and upserts its store), creating normalized products.
#[utoipa::path(
    post,
    path = "/api/receipts",
    tag = "Receipts",
    request_body = SaveReceiptBody,
    responses(
        (status = 201, description = "Receipt saved"),
        (status = 400, description = "Invalid receipt payload"),
    ),
)]
pub async fn save_receipt(
    State(state): State<AppState>,
    Json(payload): Json<SaveReceiptBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    if payload.items.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Receipt must have at least one item" })),
        ));
    }

    let store_name = payload.store_name.trim();
    if store_name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "store_name must not be empty" })),
        ));
    }

    let cnpj = payload
        .cnpj
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty());

    let source = match payload.source.as_deref() {
        Some("nfce") => Some("nfce"),
        Some("ocr") => Some("ocr"),
        Some(other) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("source must be 'nfce' or 'ocr', got '{other}'") })),
            ))
        }
        None => None,
    };

    let store_id = resolve_store(&state.pg_pool, store_name, cnpj)
        .await
        .map_err(|e| {
            error!("store upsert failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save store" })),
            )
        })?;

    let receipt_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO receipts (id, store_id, total_amount, receipt_date, qr_data, source)
         VALUES ($1, $2, $3, $4, '{}'::jsonb, $5)",
    )
    .bind(receipt_id)
    .bind(store_id)
    .bind(payload.total)
    .bind(payload.date)
    .bind(source)
    .execute(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("receipt insert failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to save receipt" })),
        )
    })?;

    for item in &payload.items {
        let description = item.description.trim();
        if description.is_empty() {
            continue;
        }

        let product_id = upsert_product(&state.pg_pool, description)
            .await
            .map_err(|e| {
                error!("product upsert failed: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to save item" })),
                )
            })?;

        let quantity = item.quantity.unwrap_or(Decimal::ONE);

        sqlx::query(
            "INSERT INTO receipt_items (id, receipt_id, description, quantity, unit_price, total_price, normalized_product_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(receipt_id)
        .bind(description)
        .bind(quantity)
        .bind(item.unit_price)
        .bind(item.total_price.or_else(|| {
            item.unit_price
                .map(|unit| unit * quantity)
                .or(Some(Decimal::ZERO))
        }))
        .bind(Some(product_id))
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("item insert failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save item" })),
            )
        })?;
    }

    // The receipt header total stays authoritative: it is what the receipt
    // printed (and what the user reviewed), and it can legitimately differ from
    // the sum of the line items. Only *item* edits rewrite it, because then the
    // items are the only thing left to go by.

    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": receipt_id, "store_id": store_id })),
    ))
}

/// Lists saved receipts with optional filters.
///
/// Every filter is bound as text and cast in SQL, so the same builder serves
/// names, dates, amounts, ids and pagination.
#[utoipa::path(
    get,
    path = "/api/receipts",
    tag = "Receipts",
    params(
        ("search" = Option<String>, Query, description = "Matches the store name or an item description"),
        ("store_id" = Option<Uuid>, Query, description = "Restrict to one store"),
        ("from" = Option<String>, Query, description = "Inclusive lower bound on the receipt date"),
        ("to" = Option<String>, Query, description = "Exclusive upper bound on the receipt date"),
        ("min_total" = Option<String>, Query, description = "Minimum receipt total"),
        ("max_total" = Option<String>, Query, description = "Maximum receipt total"),
        ("source" = Option<String>, Query, description = "nfce | ocr"),
        ("page" = Option<u32>, Query, description = "Page offset (default 0)"),
        ("page_size" = Option<u32>, Query, description = "Page size (default 50, max 200)"),
    ),
    responses(
        (status = 200, description = "Paginated receipts", body = ReceiptListResponse),
    ),
)]
pub async fn list_receipts(
    State(state): State<AppState>,
    Query(params): Query<ReceiptListParams>,
) -> Result<Json<ReceiptListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let page_size = params.page_size.unwrap_or(50).clamp(1, 200);
    let page = params.page.unwrap_or(0);
    let offset = page.saturating_mul(page_size);

    let search = params
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s));

    let binds = [
        search,
        params.store_id.map(|id| id.to_string()),
        params.from.map(|d| d.to_string()),
        params.to.map(|d| d.to_string()),
        params.min_total.map(|d| d.to_string()),
        params.max_total.map(|d| d.to_string()),
        params.source.clone(),
        Some(page_size.to_string()),
        Some(offset.to_string()),
    ];

    let filter = "WHERE ($1::text IS NULL
                    OR s.name ILIKE $1::text
                    OR EXISTS (SELECT 1 FROM receipt_items ri2
                               WHERE ri2.receipt_id = r.id
                                 AND ri2.description ILIKE $1::text))
                 AND ($2::text IS NULL OR r.store_id = $2::text::uuid)
                 AND ($3::text IS NULL OR r.receipt_date >= $3::text::date)
                 AND ($4::text IS NULL OR r.receipt_date < $4::text::date)
                 AND ($5::text IS NULL OR r.total_amount >= $5::text::numeric)
                 AND ($6::text IS NULL OR r.total_amount <= $6::text::numeric)
                 AND ($7::text IS NULL OR r.source = $7::text)";

    let count_sql = format!(
        "SELECT COUNT(*)::bigint FROM receipts r
         LEFT JOIN stores s ON s.id = r.store_id
         {filter}"
    );
    let mut count_query = sqlx::query_scalar::<_, i64>(AssertSqlSafe(count_sql));
    for value in &binds[..7] {
        count_query = count_query.bind(value.as_deref());
    }
    let total_count = count_query.fetch_one(&state.pg_pool).await.map_err(|e| {
        error!("receipt count failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list receipts" })),
        )
    })?;

    let list_sql = format!(
        "SELECT r.id, r.store_id, s.name AS store_name, r.receipt_date, r.scanned_at,
                r.total_amount,
                (SELECT COUNT(*)::bigint FROM receipt_items ri WHERE ri.receipt_id = r.id)
                    AS item_count,
                r.source
         FROM receipts r
         LEFT JOIN stores s ON s.id = r.store_id
         {filter}
         ORDER BY r.receipt_date DESC NULLS LAST, r.scanned_at DESC
         LIMIT $8::text::bigint OFFSET $9::text::bigint"
    );
    let mut list_query = sqlx::query_as::<_, ReceiptSummary>(AssertSqlSafe(list_sql));
    for value in &binds {
        list_query = list_query.bind(value.as_deref());
    }
    let rows = list_query.fetch_all(&state.pg_pool).await.map_err(|e| {
        error!("receipt list failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list receipts" })),
        )
    })?;

    // Items for the visible receipts in one batch, so the UI can resolve
    // products for price history without a request per receipt.
    let receipt_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let items = if receipt_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, ReceiptItemDetail>(
            "SELECT ri.id, ri.receipt_id, ri.description, ri.quantity, ri.unit_price,
                    ri.total_price, ri.normalized_product_id, np.name AS product_name
             FROM receipt_items ri
             LEFT JOIN normalized_products np ON np.id = ri.normalized_product_id
             WHERE ri.receipt_id = ANY($1)
             ORDER BY ri.description",
        )
        .bind(&receipt_ids)
        .fetch_all(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("receipt items fetch failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to list receipt items" })),
            )
        })?
    };

    Ok(Json(ReceiptListResponse {
        items: rows,
        total_count,
        page,
        page_size,
        items_by_receipt: items,
    }))
}

/// Loads one receipt with its store and items.
async fn load_receipt(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<ReceiptDetail>, sqlx::Error> {
    let receipt = sqlx::query_as::<_, ReceiptSummary>(
        "SELECT r.id, r.store_id, s.name AS store_name, r.receipt_date, r.scanned_at,
                r.total_amount,
                (SELECT COUNT(*)::bigint FROM receipt_items ri WHERE ri.receipt_id = r.id)
                    AS item_count,
                r.source
         FROM receipts r
         LEFT JOIN stores s ON s.id = r.store_id
         WHERE r.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let receipt = match receipt {
        Some(receipt) => receipt,
        None => return Ok(None),
    };

    let cnpj: Option<String> = match receipt.store_id {
        Some(store_id) => sqlx::query_scalar("SELECT cnpj FROM stores WHERE id = $1")
            .bind(store_id)
            .fetch_optional(pool)
            .await?
            .flatten(),
        None => None,
    };

    let items = sqlx::query_as::<_, ReceiptItemDetail>(
        "SELECT ri.id, ri.receipt_id, ri.description, ri.quantity, ri.unit_price,
                ri.total_price, ri.normalized_product_id, np.name AS product_name
         FROM receipt_items ri
         LEFT JOIN normalized_products np ON np.id = ri.normalized_product_id
         WHERE ri.receipt_id = $1
         ORDER BY ri.description",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    Ok(Some(ReceiptDetail {
        receipt,
        cnpj,
        items,
    }))
}

/// Returns one receipt with its items.
#[utoipa::path(
    get,
    path = "/api/receipts/{id}",
    tag = "Receipts",
    params(
        ("id" = Uuid, Path, description = "Receipt UUID"),
    ),
    responses(
        (status = 200, description = "Receipt detail", body = ReceiptDetail),
        (status = 404, description = "Receipt not found"),
    ),
)]
pub async fn get_receipt(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ReceiptDetail>, (StatusCode, Json<serde_json::Value>)> {
    let detail = load_receipt(&state.pg_pool, id).await.map_err(|e| {
        error!("receipt detail failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch receipt" })),
        )
    })?;

    detail.map(Json).ok_or((
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "Receipt not found" })),
    ))
}

/// Deletes a receipt and everything that only existed because of it.
#[utoipa::path(
    delete,
    path = "/api/receipts/{id}",
    tag = "Receipts",
    params(
        ("id" = Uuid, Path, description = "Receipt UUID"),
    ),
    responses(
        (status = 204, description = "Receipt deleted"),
        (status = 404, description = "Receipt not found"),
    ),
)]
pub async fn delete_receipt(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let store_id: Option<Option<Uuid>> =
        sqlx::query_scalar("SELECT store_id FROM receipts WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("receipt lookup failed: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to delete receipt" })),
                )
            })?;

    let store_id = match store_id {
        Some(store_id) => store_id,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Receipt not found" })),
            ))
        }
    };

    // Items cascade with the receipt.
    sqlx::query("DELETE FROM receipts WHERE id = $1")
        .bind(id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("receipt delete failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete receipt" })),
            )
        })?;

    // Clean up rows nothing points at any more, so the Stores and Items screens
    // never list an entry with zero records.
    if let Some(store_id) = store_id {
        sqlx::query(
            "DELETE FROM stores
             WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM receipts WHERE store_id = $1)",
        )
        .bind(store_id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| error!("orphan store cleanup failed: {}", e))
        .ok();
    }

    sqlx::query(
        "DELETE FROM normalized_products p
         WHERE NOT EXISTS (SELECT 1 FROM receipt_items ri WHERE ri.normalized_product_id = p.id)",
    )
    .execute(&state.pg_pool)
    .await
    .map_err(|e| error!("orphan product cleanup failed: {}", e))
    .ok();

    Ok(StatusCode::NO_CONTENT)
}

/// Returns price history for a normalized product.
#[utoipa::path(
    get,
    path = "/api/receipts/price-history",
    tag = "Receipts",
    responses(
        (status = 200, description = "Price history"),
    ),
)]
pub async fn price_history(
    State(state): State<AppState>,
    Query(params): Query<PriceHistoryParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let months = params.months.unwrap_or(6).clamp(1, 24);

    // Approximate the start date as months * 30 days.
    let start = chrono::Utc::now().date_naive() - chrono::Duration::days((months * 30) as i64);

    #[derive(sqlx::FromRow, serde::Serialize)]
    struct PricePoint {
        receipt_date: Option<NaiveDate>,
        store_name: Option<String>,
        unit_price: Option<Decimal>,
        description: String,
    }

    let rows: Vec<PricePoint> = sqlx::query_as(
        "SELECT r.receipt_date, s.name AS store_name, ri.unit_price, ri.description
         FROM receipt_items ri
         JOIN receipts r ON r.id = ri.receipt_id
         LEFT JOIN stores s ON s.id = r.store_id
         WHERE ri.normalized_product_id = $1
           AND (r.receipt_date IS NULL OR r.receipt_date >= $2)
         ORDER BY r.receipt_date DESC",
    )
    .bind(params.product_id)
    .bind(start)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("price history failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch price history" })),
        )
    })?;

    Ok(Json(
        json!({ "product_id": params.product_id, "points": rows }),
    ))
}

/// Merges two normalized products. Items move to the target and the source is deleted.
#[utoipa::path(
    post,
    path = "/api/receipts/product/merge",
    tag = "Receipts",
    request_body = MergeProductsRequest,
    responses(
        (status = 200, description = "Products merged"),
        (status = 400, description = "Invalid product IDs"),
    ),
)]
pub async fn merge_products(
    State(state): State<AppState>,
    Json(payload): Json<MergeProductsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if payload.target_id == payload.source_id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "target_id and source_id must differ" })),
        ));
    }

    sqlx::query(
        "UPDATE receipt_items SET normalized_product_id = $1 WHERE normalized_product_id = $2",
    )
    .bind(payload.target_id)
    .bind(payload.source_id)
    .execute(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("merge update failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to merge products" })),
        )
    })?;

    let deleted = sqlx::query("DELETE FROM normalized_products WHERE id = $1")
        .bind(payload.source_id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("merge delete failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete source product" })),
            )
        })?;

    if deleted.rows_affected() == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Source product not found" })),
        ));
    }

    Ok(Json(json!({
        "target_id": payload.target_id,
        "source_id": payload.source_id,
        "status": "merged"
    })))
}

/// Updates one receipt item and recomputes the receipt total.
#[utoipa::path(
    put,
    path = "/api/receipts/{id}/items/{item_id}",
    tag = "Receipts",
    params(
        ("id" = Uuid, Path, description = "Receipt UUID"),
        ("item_id" = Uuid, Path, description = "Receipt item UUID"),
    ),
    request_body = UpdateReceiptItemRequest,
    responses(
        (status = 200, description = "Receipt after the edit", body = ReceiptDetail),
        (status = 400, description = "Invalid item payload"),
        (status = 404, description = "Receipt or item not found"),
    ),
)]
pub async fn update_receipt_item(
    State(state): State<AppState>,
    Path((receipt_id, item_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateReceiptItemRequest>,
) -> Result<Json<ReceiptDetail>, (StatusCode, Json<serde_json::Value>)> {
    let description = payload.description.trim();
    if description.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "description must not be empty" })),
        ));
    }

    let existing: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM receipt_items WHERE id = $1 AND receipt_id = $2")
            .bind(item_id)
            .bind(receipt_id)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("receipt item lookup failed: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to update item" })),
                )
            })?;

    if existing.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Receipt item not found" })),
        ));
    }

    let product_id = upsert_product(&state.pg_pool, description)
        .await
        .map_err(|e| {
            error!("product upsert failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to update item" })),
            )
        })?;

    let quantity = payload.quantity.unwrap_or(Decimal::ONE);

    sqlx::query(
        "UPDATE receipt_items
         SET description = $1, quantity = $2, unit_price = $3, total_price = $4,
             normalized_product_id = $5
         WHERE id = $6 AND receipt_id = $7",
    )
    .bind(description)
    .bind(quantity)
    .bind(payload.unit_price)
    .bind(
        payload
            .total_price
            .or_else(|| payload.unit_price.map(|unit| unit * quantity)),
    )
    .bind(Some(product_id))
    .bind(item_id)
    .bind(receipt_id)
    .execute(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("receipt item update failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update item" })),
        )
    })?;

    refresh_receipt_total(&state.pg_pool, receipt_id)
        .await
        .map_err(|e| {
            error!("receipt total refresh failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to update item" })),
            )
        })?;

    let detail = load_receipt(&state.pg_pool, receipt_id)
        .await
        .map_err(|e| {
            error!("receipt reload failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch receipt" })),
            )
        })?;

    detail.map(Json).ok_or((
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "Receipt not found" })),
    ))
}

/// Deletes one receipt item and recomputes the receipt total.
#[utoipa::path(
    delete,
    path = "/api/receipts/{id}/items/{item_id}",
    tag = "Receipts",
    params(
        ("id" = Uuid, Path, description = "Receipt UUID"),
        ("item_id" = Uuid, Path, description = "Receipt item UUID"),
    ),
    responses(
        (status = 200, description = "Receipt after the delete", body = ReceiptDetail),
        (status = 404, description = "Receipt or item not found"),
    ),
)]
pub async fn delete_receipt_item(
    State(state): State<AppState>,
    Path((receipt_id, item_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ReceiptDetail>, (StatusCode, Json<serde_json::Value>)> {
    let product_id: Option<Option<Uuid>> = sqlx::query_scalar(
        "SELECT normalized_product_id FROM receipt_items WHERE id = $1 AND receipt_id = $2",
    )
    .bind(item_id)
    .bind(receipt_id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("receipt item lookup failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to delete item" })),
        )
    })?;

    let product_id = match product_id {
        Some(product_id) => product_id,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Receipt item not found" })),
            ))
        }
    };

    sqlx::query("DELETE FROM receipt_items WHERE id = $1 AND receipt_id = $2")
        .bind(item_id)
        .bind(receipt_id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("receipt item delete failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete item" })),
            )
        })?;

    if let Some(product_id) = product_id {
        sqlx::query(
            "DELETE FROM normalized_products p
             WHERE p.id = $1
               AND NOT EXISTS (SELECT 1 FROM receipt_items ri
                               WHERE ri.normalized_product_id = p.id)",
        )
        .bind(product_id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| error!("orphan product cleanup failed: {}", e))
        .ok();
    }

    refresh_receipt_total(&state.pg_pool, receipt_id)
        .await
        .map_err(|e| {
            error!("receipt total refresh failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete item" })),
            )
        })?;

    let detail = load_receipt(&state.pg_pool, receipt_id)
        .await
        .map_err(|e| {
            error!("receipt reload failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch receipt" })),
            )
        })?;

    detail.map(Json).ok_or((
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "Receipt not found" })),
    ))
}

/// Headline numbers for the Overview tab.
///
/// One query with scalar subqueries: cheap enough to call on every visit, and
/// it never loads receipt rows just to count them.
#[utoipa::path(
    get,
    path = "/api/receipts/stats",
    tag = "Receipts",
    params(
        ("month" = Option<String>, Query, description = "Month to report on, YYYY-MM (default: current month)"),
    ),
    responses(
        (status = 200, description = "Receipt statistics", body = ReceiptStats),
    ),
)]
pub async fn receipt_stats(
    State(state): State<AppState>,
    Query(params): Query<ReceiptStatsParams>,
) -> Result<Json<ReceiptStats>, (StatusCode, Json<serde_json::Value>)> {
    let today = Utc::now().date_naive();
    let invalid_month = || {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "month must be formatted as YYYY-MM" })),
        )
    };

    let (year, month) = match params.month.as_deref() {
        Some(value) => {
            let (y, m) = value.split_once('-').ok_or_else(invalid_month)?;
            let year: i32 = y.parse().map_err(|_| invalid_month())?;
            let month: u32 = m.parse().map_err(|_| invalid_month())?;
            if !(1..=12).contains(&month) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "month must be between 01 and 12" })),
                ));
            }
            (year, month)
        }
        None => (today.year(), today.month()),
    };

    let month_start = NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(invalid_month)?;
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .ok_or_else(invalid_month)?;

    let stats = sqlx::query_as::<_, ReceiptStats>(
        "SELECT
             (SELECT COUNT(*)::bigint FROM receipts) AS total_receipts,
             (SELECT COUNT(*)::bigint FROM receipts
              WHERE receipt_date >= $1 AND receipt_date < $2) AS receipts_this_month,
             (SELECT COALESCE(SUM(total_amount), 0) FROM receipts) AS total_spent,
             (SELECT COALESCE(SUM(total_amount), 0) FROM receipts
              WHERE receipt_date >= $1 AND receipt_date < $2) AS spent_this_month,
             (SELECT COUNT(DISTINCT normalized_product_id)::bigint FROM receipt_items
              WHERE normalized_product_id IS NOT NULL) AS items_tracked,
             (SELECT COUNT(*)::bigint FROM receipt_items
              WHERE unit_price IS NOT NULL AND normalized_product_id IS NOT NULL)
                 AS price_records,
             (SELECT COUNT(DISTINCT store_id)::bigint FROM receipts) AS store_count,
             (SELECT MIN(receipt_date) FROM receipts) AS first_receipt_date,
             (SELECT MAX(receipt_date) FROM receipts) AS last_receipt_date,
             $1::date AS month",
    )
    .bind(month_start)
    .bind(next_month)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("receipt stats failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch receipt statistics" })),
        )
    })?;

    Ok(Json(stats))
}
