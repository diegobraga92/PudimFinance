//! Receipt scanning and price-tracking endpoints.
//!
//! Uses the NFC-e QR parser (no OCR) to turn a QR code string into a receipt,
//! persists receipts and items, and exposes price history and product merging.

#![allow(clippy::result_large_err)]

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use tracing::error;
use uuid::Uuid;

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

/// Query params for receipt list.
#[derive(Debug, Default, Deserialize)]
pub struct ReceiptListParams {
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
        .route(
            "/api/receipts",
            axum::routing::get(list_receipts).post(save_receipt),
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
        "total": parsed.total.to_string(),
        "icms": parsed.icms.to_string(),
        "date": parsed.date,
        "cnpj": parsed.cnpj,
        "store_name": parsed.store_name,
        "version": parsed.version,
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

/// Line item for saving a receipt.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ReceiptItemInput {
    /// Item description (also becomes a normalized product).
    pub description: String,
    /// Quantity purchased (default 1).
    pub quantity: Option<Decimal>,
    /// Unit price.
    pub unit_price: Option<Decimal>,
    /// Total price for the line.
    pub total_price: Option<Decimal>,
}

/// Request payload for saving a fully parsed/reviewed receipt.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SaveReceiptRequest {
    /// Store name (or from scan).
    pub store_name: String,
    /// Store CNPJ (optional).
    pub cnpj: Option<String>,
    /// Receipt date.
    pub date: NaiveDate,
    /// Total amount.
    pub total: Decimal,
    /// Line items (at least one).
    pub items: Vec<ReceiptItemInput>,
}

/// Saves a reviewed receipt (and upserts its store), creating normalized products.
#[utoipa::path(
    post,
    path = "/api/receipts",
    tag = "Receipts",
    request_body = SaveReceiptRequest,
    responses(
        (status = 201, description = "Receipt saved"),
        (status = 400, description = "Invalid receipt payload"),
    ),
)]
pub async fn save_receipt(
    State(state): State<AppState>,
    Json(payload): Json<SaveReceiptRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    if payload.items.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Receipt must have at least one item" })),
        ));
    }

    let store_id = Uuid::new_v4();
    let store_sql = "INSERT INTO stores (id, name, cnpj)
                     VALUES ($1, $2, $3)
                     ON CONFLICT DO NOTHING";
    sqlx::query(store_sql)
        .bind(store_id)
        .bind(&payload.store_name)
        .bind(&payload.cnpj)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("store insert failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save store" })),
            )
        })?;

    let receipt_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO receipts (id, store_id, total_amount, receipt_date, qr_data)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)",
    )
    .bind(receipt_id)
    .bind(store_id)
    .bind(payload.total)
    .bind(payload.date)
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
        // Upsert normalized product by name.
        let product_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO normalized_products (id, name)
             VALUES ($1, $2)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name",
        )
        .bind(product_id)
        .bind(&item.description)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("product insert failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save item" })),
            )
        })?;

        let found: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM normalized_products WHERE name = $1")
                .bind(&item.description)
                .fetch_optional(&state.pg_pool)
                .await
                .ok()
                .flatten();

        sqlx::query(
            "INSERT INTO receipt_items (id, receipt_id, description, quantity, unit_price, total_price, normalized_product_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(receipt_id)
        .bind(&item.description)
        .bind(item.quantity.unwrap_or(Decimal::ONE))
        .bind(item.unit_price)
        .bind(item.total_price.unwrap_or_else(|| item.unit_price.unwrap_or_default()))
        .bind(found)
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

    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": receipt_id, "store_id": store_id })),
    ))
}

/// Lists saved receipts (paginated).
#[utoipa::path(
    get,
    path = "/api/receipts",
    tag = "Receipts",
    responses(
        (status = 200, description = "List of receipts"),
    ),
)]
pub async fn list_receipts(
    State(state): State<AppState>,
    Query(params): Query<ReceiptListParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let page_size = params.page_size.unwrap_or(50).clamp(1, 200);
    let page = params.page.unwrap_or(0);
    let offset = page.saturating_mul(page_size);

    #[derive(sqlx::FromRow, serde::Serialize)]
    struct ReceiptRow {
        id: Uuid,
        store_id: Option<Uuid>,
        store_name: Option<String>,
        total_amount: Option<Decimal>,
        receipt_date: Option<NaiveDate>,
        item_count: i64,
    }

    #[derive(sqlx::FromRow, serde::Serialize)]
    struct ReceiptItemRow {
        id: Uuid,
        receipt_id: Uuid,
        description: String,
        quantity: Decimal,
        unit_price: Decimal,
        total_price: Decimal,
        normalized_product_id: Option<Uuid>,
    }

    let rows: Vec<ReceiptRow> = sqlx::query_as(
        "SELECT r.id, r.store_id, s.name AS store_name, r.total_amount, r.receipt_date,
                (SELECT COUNT(*) FROM receipt_items ri WHERE ri.receipt_id = r.id) AS item_count
         FROM receipts r
         LEFT JOIN stores s ON s.id = r.store_id
         ORDER BY r.receipt_date DESC
         LIMIT $1 OFFSET $2",
    )
    .bind(page_size as i64)
    .bind(offset as i64)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("receipt list failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list receipts" })),
        )
    })?;

    // Fetch items for the visible receipts in one batch so the UI can expose
    // normalized product ids for price-history and product-merge features.
    let receipt_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let items: Vec<ReceiptItemRow> = if receipt_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT id, receipt_id, description, quantity, unit_price, total_price,
                    normalized_product_id
             FROM receipt_items
             WHERE receipt_id = ANY($1)
             ORDER BY description",
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

    Ok(Json(json!({
        "items": rows,
        "page": page,
        "page_size": page_size,
        "items_by_receipt": items,
    })))
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
