//! Monthly summary endpoint.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Datelike, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use tracing::error;
use utoipa::ToSchema;

use crate::models::{CategorySummary, SummaryResponse};
use crate::state::AppState;

/// Query parameters for the summary endpoint.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct SummaryParams {
    /// Year to summarise (defaults to current year).
    pub year: Option<i32>,
    /// Month to summarise, 1-12 (defaults to current month).
    pub month: Option<u32>,
}

/// Returns a sub-router with the summary route mounted under `/api/summary`.
pub fn router() -> Router<AppState> {
    Router::new().route("/api/summary", get(get_summary))
}

/// Returns income, expense, and balance totals for a given month,
/// with a per-category breakdown.
#[utoipa::path(
    get,
    path = "/api/summary",
    tag = "Summary",
    params(
        ("year" = Option<i32>, Query, description = "Year to summarise (default: current)"),
        ("month" = Option<u32>, Query, description = "Month 1-12 (default: current)"),
    ),
    responses(
        (status = 200, description = "Monthly summary", body = SummaryResponse),
        (status = 400, description = "Invalid month parameter"),
    ),
)]
pub async fn get_summary(
    State(state): State<AppState>,
    Query(params): Query<SummaryParams>,
) -> Result<Json<SummaryResponse>, (StatusCode, Json<serde_json::Value>)> {
    let now = Utc::now();
    let year = params.year.unwrap_or_else(|| now.year());
    let month = params.month.unwrap_or_else(|| now.month());

    if !(1..=12).contains(&month) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "month must be between 1 and 12" })),
        ));
    }

    #[derive(sqlx::FromRow)]
    struct SummaryRow {
        category_id: Option<uuid::Uuid>,
        category_name: Option<String>,
        color: Option<String>,
        icon: Option<String>,
        r#type: String,
        total: Decimal,
    }

    let rows: Vec<SummaryRow> = sqlx::query_as(
        "SELECT
            t.category_id,
            c.name AS category_name,
            c.color,
            c.icon,
            t.type,
            COALESCE(SUM(t.amount), 0)::numeric AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE EXTRACT(YEAR FROM t.date)::int = $1
           AND EXTRACT(MONTH FROM t.date)::int = $2
         GROUP BY t.category_id, c.name, c.color, c.icon, t.type
         ORDER BY total DESC",
    )
    .bind(year)
    .bind(month as i32)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch summary: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch summary" })),
        )
    })?;

    let mut income_total = Decimal::ZERO;
    let mut expense_total = Decimal::ZERO;
    let mut by_category: Vec<CategorySummary> = Vec::new();

    for row in rows {
        match row.r#type.as_str() {
            "income" => income_total += row.total,
            _ => expense_total += row.total,
        }

        by_category.push(CategorySummary {
            category_id: row.category_id,
            category_name: row.category_name,
            color: row.color,
            icon: row.icon,
            total: row.total,
        });
    }

    Ok(Json(SummaryResponse {
        income_total,
        expense_total,
        balance: income_total - expense_total,
        by_category,
        year,
        month,
    }))
}
