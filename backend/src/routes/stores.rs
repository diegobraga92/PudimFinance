//! Stores derived from receipts; there is no manual store CRUD.

#![allow(clippy::result_large_err)]

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use chrono::{Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::AssertSqlSafe;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    ReceiptSummary, StoreDetail, StoreItemPrice, StoreListResponse, StoreMonthlySpend,
    StoreSummary, StoreTopItem,
};
use crate::state::AppState;

/// Store-list filters.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct StoreListParams {
    /// Case-insensitive substring match on the store name.
    pub search: Option<String>,
    /// `all` (default), `month`, `last_month`, `3m`, `6m`, `year`.
    pub period: Option<String>,
    /// `spend` (default), `name`, `recent`.
    pub sort: Option<String>,
    /// Page offset (default 0).
    pub page: Option<u32>,
    /// Page size (default 50, max 200).
    pub page_size: Option<u32>,
}

/// Turns a period name into an inclusive lower bound and an exclusive upper
/// bound on the receipt date. `None` means "unbounded".
pub fn period_bounds(period: &str) -> (Option<NaiveDate>, Option<NaiveDate>) {
    let today = Utc::now().date_naive();

    let months_back = |back: u32| -> NaiveDate {
        let mut year = today.year();
        let mut month = today.month() as i32 - back as i32;
        while month <= 0 {
            month += 12;
            year -= 1;
        }
        NaiveDate::from_ymd_opt(year, month as u32, 1).unwrap_or(today)
    };

    match period {
        "month" => (Some(months_back(0)), None),
        "last_month" => (Some(months_back(1)), Some(months_back(0))),
        "3m" => (Some(months_back(2)), None),
        "6m" => (Some(months_back(5)), None),
        "year" => (NaiveDate::from_ymd_opt(today.year(), 1, 1), None),
        _ => (None, None),
    }
}

/// Store sub-router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/stores", axum::routing::get(list_stores))
        .route("/api/stores/{id}", axum::routing::get(get_store))
}

/// Receipts limited to the requested period (both bounds optional).
const STORE_CTE: &str = "
WITH period_receipts AS (
    SELECT r.id, r.store_id, r.total_amount, r.receipt_date
    FROM receipts r
    WHERE ($1::text IS NULL OR r.receipt_date >= $1::text::date)
      AND ($2::text IS NULL OR r.receipt_date < $2::text::date)
)";

/// Per-period aggregates for every store, all-time visit bounds included.
const STORE_SELECT: &str = "
SELECT s.id, s.name, s.cnpj,
       COUNT(pr.id)::bigint AS receipt_count,
       (SELECT COUNT(*)::bigint
        FROM receipt_items ri
        WHERE ri.receipt_id IN (SELECT id FROM period_receipts WHERE store_id = s.id)) AS item_count,
       COALESCE(SUM(pr.total_amount), 0) AS total_spent,
       (SELECT MIN(r2.receipt_date) FROM receipts r2 WHERE r2.store_id = s.id) AS first_visit,
       (SELECT MAX(r2.receipt_date) FROM receipts r2 WHERE r2.store_id = s.id) AS last_visit
FROM stores s
LEFT JOIN period_receipts pr ON pr.store_id = s.id";

/// Lists stores with their receipt aggregates.
#[utoipa::path(
    get,
    path = "/api/stores",
    tag = "Stores",
    params(
        ("search" = Option<String>, Query, description = "Substring match on the store name"),
        ("period" = Option<String>, Query, description = "all | month | last_month | 3m | 6m | year"),
        ("sort" = Option<String>, Query, description = "spend | name | recent"),
        ("page" = Option<u32>, Query, description = "Page offset (default 0)"),
        ("page_size" = Option<u32>, Query, description = "Page size (default 50, max 200)"),
    ),
    responses(
        (status = 200, description = "Stores with receipt aggregates", body = StoreListResponse),
    ),
)]
pub async fn list_stores(
    State(state): State<AppState>,
    Query(params): Query<StoreListParams>,
) -> Result<Json<StoreListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let page_size = params.page_size.unwrap_or(50).clamp(1, 200);
    let page = params.page.unwrap_or(0);
    let offset = page.saturating_mul(page_size);

    let (from, to) = period_bounds(params.period.as_deref().unwrap_or("all"));
    let search = params
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s));

    let search_clause = if search.is_some() {
        " WHERE s.name ILIKE $3::text"
    } else {
        ""
    };

    let order = match params.sort.as_deref().unwrap_or("spend") {
        "name" => "s.name",
        "recent" => "last_visit DESC NULLS LAST, s.name",
        _ => "total_spent DESC, s.name",
    };

    let binds = [
        from.map(|d| d.to_string()),
        to.map(|d| d.to_string()),
        search,
        Some(page_size.to_string()),
        Some(offset.to_string()),
    ];

    let count_sql = format!(
        "{STORE_CTE}
         SELECT COUNT(*)::bigint FROM stores s
         LEFT JOIN period_receipts pr ON pr.store_id = s.id{search_clause}
         GROUP BY s.id
         HAVING COUNT(pr.id) > 0"
    );
    let mut count_query = sqlx::query_scalar::<_, i64>(AssertSqlSafe(count_sql));
    for value in &binds[..3] {
        count_query = count_query.bind(value.as_deref());
    }
    let total_count = count_query.fetch_one(&state.pg_pool).await.map_err(|e| {
        error!("store count failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list stores" })),
        )
    })?;

    let list_sql = format!(
        "{STORE_CTE}{STORE_SELECT}{search_clause}
         GROUP BY s.id, s.name, s.cnpj
         HAVING COUNT(pr.id) > 0
         ORDER BY {order}
         LIMIT $4::text::bigint OFFSET $5::text::bigint"
    );
    let mut list_query = sqlx::query_as::<_, StoreSummary>(AssertSqlSafe(list_sql));
    for value in &binds {
        list_query = list_query.bind(value.as_deref());
    }
    let items = list_query.fetch_all(&state.pg_pool).await.map_err(|e| {
        error!("store list failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list stores" })),
        )
    })?;

    Ok(Json(StoreListResponse {
        items,
        total_count,
        page,
        page_size,
    }))
}

/// Returns one store: aggregates, spend per month, most purchased items, item
/// prices recorded there and the latest receipts.
#[utoipa::path(
    get,
    path = "/api/stores/{id}",
    tag = "Stores",
    params(
        ("id" = Uuid, Path, description = "Store UUID"),
    ),
    responses(
        (status = 200, description = "Store detail", body = StoreDetail),
        (status = 404, description = "Store not found"),
    ),
)]
pub async fn get_store(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<StoreDetail>, (StatusCode, Json<serde_json::Value>)> {
    // The detail header shows lifetime numbers, so the period bounds are empty.
    let summary_sql = format!(
        "{STORE_CTE}{STORE_SELECT} WHERE s.id = $3::text::uuid GROUP BY s.id, s.name, s.cnpj"
    );
    let store = sqlx::query_as::<_, StoreSummary>(AssertSqlSafe(summary_sql))
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(id.to_string())
        .fetch_optional(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("store detail failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch store" })),
            )
        })?;

    let store = match store {
        Some(store) => store,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Store not found" })),
            ))
        }
    };

    let monthly_spend = sqlx::query_as::<_, StoreMonthlySpend>(
        "SELECT date_trunc('month', r.receipt_date)::date AS month,
                COUNT(*)::bigint AS receipt_count,
                COALESCE(SUM(r.total_amount), 0) AS total
         FROM receipts r
         WHERE r.store_id = $1 AND r.receipt_date IS NOT NULL
         GROUP BY 1
         ORDER BY 1",
    )
    .bind(id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("store monthly spend failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch store spending" })),
        )
    })?;

    // Most purchased items: the normalized identity when the item has one.
    let top_items = sqlx::query_as::<_, StoreTopItem>(
        "SELECT ri.normalized_product_id AS product_id,
                COALESCE(np.name, MAX(ri.description)) AS description,
                SUM(ri.quantity) AS quantity,
                COUNT(*)::bigint AS purchase_count,
                COALESCE(SUM(COALESCE(ri.total_price, ri.unit_price * ri.quantity, 0)), 0) AS total
         FROM receipt_items ri
         JOIN receipts r ON r.id = ri.receipt_id
         LEFT JOIN normalized_products np ON np.id = ri.normalized_product_id
         WHERE r.store_id = $1
         GROUP BY COALESCE(ri.normalized_product_id::text, lower(ri.description)),
                  ri.normalized_product_id, np.name
         ORDER BY purchase_count DESC, quantity DESC
         LIMIT 8",
    )
    .bind(id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("store top items failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch store items" })),
        )
    })?;

    // Latest and previous price per item *at this store*.
    let items = sqlx::query_as::<_, StoreItemPrice>(
        "WITH store_records AS (
             SELECT ri.description, ri.normalized_product_id, ri.unit_price AS price,
                    ri.id AS item_id, r.receipt_date, r.scanned_at
             FROM receipt_items ri
             JOIN receipts r ON r.id = ri.receipt_id
             WHERE r.store_id = $1 AND ri.unit_price IS NOT NULL
         ),
         ranked AS (
             SELECT store_records.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY COALESCE(normalized_product_id::text, lower(description))
                        ORDER BY receipt_date DESC NULLS LAST, scanned_at DESC, item_id DESC
                    ) AS rn
             FROM store_records
         ),
         picks AS (
             SELECT COALESCE(normalized_product_id::text, lower(description)) AS item_key,
                    MAX(CASE WHEN rn = 1 THEN description END) AS description,
                    MAX(CASE WHEN rn = 1 THEN normalized_product_id::text END)::uuid
                        AS normalized_product_id,
                    MAX(CASE WHEN rn = 1 THEN price END) AS latest_price,
                    MAX(CASE WHEN rn = 2 THEN price END) AS previous_price,
                    COUNT(*)::bigint AS record_count,
                    MAX(receipt_date) AS last_date
             FROM ranked
             GROUP BY 1
         )
         SELECT description, normalized_product_id, latest_price, previous_price,
                CASE
                    WHEN latest_price IS NOT NULL
                         AND previous_price IS NOT NULL
                         AND previous_price <> 0
                    THEN ROUND((latest_price - previous_price) / previous_price * 100, 2)
                END AS change_percentage,
                record_count, last_date
         FROM picks
         ORDER BY description",
    )
    .bind(id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("store item prices failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch store item prices" })),
        )
    })?;

    let recent_receipts = sqlx::query_as::<_, ReceiptSummary>(
        "SELECT r.id, r.store_id, s.name AS store_name, r.receipt_date, r.scanned_at,
                r.total_amount,
                (SELECT COUNT(*)::bigint FROM receipt_items ri WHERE ri.receipt_id = r.id)
                    AS item_count,
                r.source
         FROM receipts r
         LEFT JOIN stores s ON s.id = r.store_id
         WHERE r.store_id = $1
         ORDER BY r.receipt_date DESC NULLS LAST, r.scanned_at DESC
         LIMIT 10",
    )
    .bind(id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("store receipts failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch store receipts" })),
        )
    })?;

    Ok(Json(StoreDetail {
        store,
        monthly_spend,
        top_items,
        items,
        recent_receipts,
    }))
}
