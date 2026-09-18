//! Normalized products and price history derived from receipt items.

#![allow(clippy::result_large_err)]

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::AssertSqlSafe;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    ProductDetail, ProductListResponse, ProductPriceRecord, ProductStorePrice, ProductSummary,
};
use crate::state::AppState;

/// Query params for the product list.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ProductListParams {
    /// Case-insensitive substring match on the product name.
    pub search: Option<String>,
    /// `all` (default), `recent` (changed in the last 30 days), `increased`,
    /// `decreased`.
    pub change: Option<String>,
    /// `name` (default), `recent`, `change_desc`, `change_asc`, `records`.
    pub sort: Option<String>,
    /// Page offset (default 0).
    pub page: Option<u32>,
    /// Page size (default 50, max 200).
    pub page_size: Option<u32>,
}

/// Receipt items that carry a price, keyed by normalized product.
const RECORDS_CTE: &str = "
WITH records AS (
    SELECT ri.normalized_product_id AS product_id,
           ri.unit_price AS price,
           ri.quantity AS quantity,
           ri.description AS description,
           ri.id AS item_id,
           r.id AS receipt_id,
           r.store_id,
           r.receipt_date,
           r.scanned_at
    FROM receipt_items ri
    JOIN receipts r ON r.id = ri.receipt_id
    WHERE ri.normalized_product_id IS NOT NULL
      AND ri.unit_price IS NOT NULL
)";

/// Records ranked newest-first per product (the base for "latest"/"previous").
const RANKED_CTE: &str = "
, ranked AS (
    SELECT records.*,
           ROW_NUMBER() OVER (
               PARTITION BY product_id
               ORDER BY receipt_date DESC NULLS LAST, scanned_at DESC, item_id DESC
           ) AS rn
    FROM records
)
, stats AS (
    SELECT product_id,
           COUNT(*)::bigint AS record_count,
           COUNT(DISTINCT store_id)::bigint AS store_count,
           AVG(price) AS average_price,
           MIN(price) AS lowest_price,
           MAX(price) AS highest_price,
           MAX(receipt_date) AS last_seen,
           MIN(receipt_date) AS first_seen,
           MAX(CASE WHEN rn = 1 THEN price END) AS latest_price,
           MAX(CASE WHEN rn = 2 THEN price END) AS previous_price
    FROM ranked
    GROUP BY product_id
)";

/// Product summary projection: the statistics plus the derived change.
const PRODUCT_SELECT: &str = "
SELECT p.id, p.name, p.category,
       s.record_count, s.store_count,
       s.latest_price, s.previous_price,
       CASE
           WHEN s.latest_price IS NOT NULL
                AND s.previous_price IS NOT NULL
                AND s.previous_price <> 0
           THEN ROUND((s.latest_price - s.previous_price) / s.previous_price * 100, 2)
       END AS change_percentage,
       s.average_price, s.lowest_price, s.highest_price, s.last_seen, s.first_seen
FROM normalized_products p
JOIN stats s ON s.product_id = p.id";

/// Product sub-router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/products", axum::routing::get(list_products))
        .route("/api/products/{id}", axum::routing::get(get_product))
}

/// Lists products with price statistics.
#[utoipa::path(
    get,
    path = "/api/products",
    tag = "Products",
    params(
        ("search" = Option<String>, Query, description = "Substring match on the product name"),
        ("change" = Option<String>, Query, description = "all | recent | increased | decreased"),
        ("sort" = Option<String>, Query, description = "name | recent | change_desc | change_asc | records"),
        ("page" = Option<u32>, Query, description = "Page offset (default 0)"),
        ("page_size" = Option<u32>, Query, description = "Page size (default 50, max 200)"),
    ),
    responses(
        (status = 200, description = "Products with price statistics", body = ProductListResponse),
    ),
)]
pub async fn list_products(
    State(state): State<AppState>,
    Query(params): Query<ProductListParams>,
) -> Result<Json<ProductListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let page_size = params.page_size.unwrap_or(50).clamp(1, 200);
    let page = params.page.unwrap_or(0);
    let offset = page.saturating_mul(page_size);

    // Filters are bound as text and cast in SQL, so one binding loop can carry
    // search text, pagination and limits.
    let mut conditions: Vec<String> = Vec::new();
    let mut binds: Vec<String> = Vec::new();

    if let Some(search) = params
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        binds.push(format!("%{}%", search));
        conditions.push(format!("p.name ILIKE ${}", binds.len()));
    }

    match params.change.as_deref().unwrap_or("all") {
        "increased" => conditions
            .push("s.previous_price IS NOT NULL AND s.latest_price > s.previous_price".to_string()),
        "decreased" => conditions
            .push("s.previous_price IS NOT NULL AND s.latest_price < s.previous_price".to_string()),
        "recent" => conditions.push(
            "s.previous_price IS NOT NULL AND s.last_seen >= CURRENT_DATE - INTERVAL '30 days'"
                .to_string(),
        ),
        _ => {}
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    let order = match params.sort.as_deref().unwrap_or("name") {
        "recent" => "s.last_seen DESC NULLS LAST, p.name",
        "change_desc" => "change_percentage DESC NULLS LAST, p.name",
        "change_asc" => "change_percentage ASC NULLS LAST, p.name",
        "records" => "s.record_count DESC, p.name",
        _ => "p.name",
    };

    let count_sql = format!(
        "{RECORDS_CTE}{RANKED_CTE}
         SELECT COUNT(*)::bigint FROM normalized_products p
         JOIN stats s ON s.product_id = p.id{where_clause}"
    );

    let mut count_query = sqlx::query_scalar::<_, i64>(AssertSqlSafe(count_sql));
    for value in &binds {
        count_query = count_query.bind(value.as_str());
    }
    let total_count = count_query.fetch_one(&state.pg_pool).await.map_err(|e| {
        error!("product count failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list products" })),
        )
    })?;

    let mut list_binds = binds.clone();
    list_binds.push(page_size.to_string());
    list_binds.push(offset.to_string());
    let list_sql = format!(
        "{RECORDS_CTE}{RANKED_CTE}{PRODUCT_SELECT}{where_clause}
         ORDER BY {order}
         LIMIT ${}::bigint OFFSET ${}::bigint",
        list_binds.len() - 1,
        list_binds.len()
    );

    let mut list_query = sqlx::query_as::<_, ProductSummary>(AssertSqlSafe(list_sql));
    for value in &list_binds {
        list_query = list_query.bind(value.as_str());
    }
    let items = list_query.fetch_all(&state.pg_pool).await.map_err(|e| {
        error!("product list failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list products" })),
        )
    })?;

    Ok(Json(ProductListResponse {
        items,
        total_count,
        page,
        page_size,
    }))
}

/// Returns one product with its statistics, every recorded price and where it
/// was bought (cheapest latest price first).
#[utoipa::path(
    get,
    path = "/api/products/{id}",
    tag = "Products",
    params(
        ("id" = Uuid, Path, description = "Normalized product UUID"),
    ),
    responses(
        (status = 200, description = "Product price history", body = ProductDetail),
        (status = 404, description = "Product not found"),
    ),
)]
pub async fn get_product(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ProductDetail>, (StatusCode, Json<serde_json::Value>)> {
    let detail_sql = format!("{RECORDS_CTE}{RANKED_CTE}{PRODUCT_SELECT} WHERE p.id = $1");
    let product = sqlx::query_as::<_, ProductSummary>(AssertSqlSafe(detail_sql))
        .bind(id)
        .fetch_optional(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("product detail failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch product" })),
            )
        })?;

    let product = match product {
        Some(product) => product,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Product not found" })),
            ))
        }
    };

    let records_sql = format!(
        "{RECORDS_CTE}
         SELECT r.receipt_id, r.receipt_date AS date, s.name AS store_name, r.store_id,
                r.price, r.quantity, r.description
         FROM records r
         LEFT JOIN stores s ON s.id = r.store_id
         WHERE r.product_id = $1
         ORDER BY r.receipt_date DESC NULLS LAST, r.scanned_at DESC, r.item_id DESC"
    );
    let records = sqlx::query_as::<_, ProductPriceRecord>(AssertSqlSafe(records_sql))
        .bind(id)
        .fetch_all(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("product records failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch price records" })),
            )
        })?;

    // Per-store ranking: the newest (and previous) price *at that store*.
    let by_store_sql = format!(
        "{RECORDS_CTE}
         , store_ranked AS (
             SELECT records.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY store_id
                        ORDER BY receipt_date DESC NULLS LAST, scanned_at DESC, item_id DESC
                    ) AS srn
             FROM records
             WHERE product_id = $1
         )
         , picks AS (
             SELECT store_id,
                    MAX(CASE WHEN srn = 1 THEN price END) AS latest_price,
                    MAX(CASE WHEN srn = 2 THEN price END) AS previous_price,
                    AVG(price) AS average_price,
                    COUNT(*)::bigint AS record_count,
                    MAX(receipt_date) AS last_date
             FROM store_ranked
             GROUP BY store_id
         )
         SELECT p.store_id, s.name AS store_name, p.latest_price, p.previous_price,
                CASE
                    WHEN p.latest_price IS NOT NULL
                         AND p.previous_price IS NOT NULL
                         AND p.previous_price <> 0
                    THEN ROUND((p.latest_price - p.previous_price) / p.previous_price * 100, 2)
                END AS change_percentage,
                p.average_price, p.record_count, p.last_date
         FROM picks p
         LEFT JOIN stores s ON s.id = p.store_id
         ORDER BY p.latest_price ASC NULLS LAST, s.name"
    );
    let by_store = sqlx::query_as::<_, ProductStorePrice>(AssertSqlSafe(by_store_sql))
        .bind(id)
        .fetch_all(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("product store prices failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch store prices" })),
            )
        })?;

    Ok(Json(ProductDetail {
        product,
        records,
        by_store,
    }))
}
