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
use crate::routes::settings;
use crate::state::AppState;

/// Summary filters.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct SummaryParams {
    /// Year to summarise (defaults to current year).
    pub year: Option<i32>,
    /// Month to summarise, 1-12 (defaults to current month).
    pub month: Option<u32>,
}

/// Routes for monthly summaries.
pub fn router() -> Router<AppState> {
    Router::new().route("/api/summary", get(get_summary))
}

/// Returns monthly totals with a category breakdown.
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
        // `effective_transaction_date` honours the card-expense dating
        // preference (purchase date vs. bill due date). The extra `date`
        // predicate keeps the scan index-friendly: the effective date is never
        // earlier than the transaction date, and never more than a billing
        // cycle later.
        "SELECT
            t.category_id,
            c.name AS category_name,
            c.color,
            c.icon,
            t.type,
            COALESCE(SUM(t.amount), 0)::numeric AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.date >= make_date($1, $2, 1) - INTERVAL '3 months'
           AND date_trunc('month', effective_transaction_date(t.date, t.account_id, $3))
               = make_date($1, $2, 1)
         GROUP BY t.category_id, c.name, c.color, c.icon, t.type
         ORDER BY total DESC",
    )
    .bind(year)
    .bind(month as i32)
    .bind(settings::card_expense_dating(&state.pg_pool).await)
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
        if row.r#type == "income" {
            income_total += row.total;
            continue;
        }
        expense_total += row.total;
        // `by_category` is the *expense* breakdown (the per-category totals the
        // dashboards chart); income accounts are reported through `income_total`.
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
