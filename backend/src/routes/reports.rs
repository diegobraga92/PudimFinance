//! Report endpoints for Layer 2 insights.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    CategoryBreakdownItem, CategoryBreakdownResponse, MonthlyReportItem, MonthlyReportResponse,
    TrendPoint, TrendsResponse,
};
use crate::routes::settings;
use crate::state::AppState;

/// Query parameters for the monthly report.
#[derive(Debug, Default, Deserialize)]
pub struct MonthlyParams {
    /// Start year (defaults to 6 months ago).
    pub start_year: Option<i32>,
    /// Start month (defaults to 6 months ago).
    pub start_month: Option<i32>,
    /// End year (defaults to the current year).
    pub end_year: Option<i32>,
    /// End month (defaults to the current month).
    pub end_month: Option<i32>,
    /// Restrict to a single source account (payment method) UUID.
    pub account_id: Option<Uuid>,
}

/// Query parameters for the category breakdown report.
#[derive(Debug, Default, Deserialize)]
pub struct BreakdownParams {
    /// Start date (ISO `YYYY-MM-DD`). Defaults to the first day of the current month.
    pub start_date: Option<NaiveDate>,
    /// End date (ISO `YYYY-MM-DD`). Defaults to today.
    pub end_date: Option<NaiveDate>,
}

/// Query parameters for the trends report.
#[derive(Debug, Deserialize)]
pub struct TrendsParams {
    /// Number of months to include (default 6, max 12).
    pub months: Option<i32>,
}

/// Returns a sub-router with all report routes mounted under `/api/reports`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/reports/monthly", get(monthly_report))
        .route("/api/reports/category-breakdown", get(category_breakdown))
        .route("/api/reports/trends", get(trends))
}

/// Validates that month is in 1..=12.
fn valid_month(month: i32) -> bool {
    (1..=12).contains(&month)
}

/// Returns the first day of the month containing `d`.
fn month_start(d: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(d.year(), d.month(), 1).unwrap()
}

/// Adds a number of months to a date, clamping the day to the last valid day.
fn add_months(d: NaiveDate, months: i32) -> NaiveDate {
    let total = d.year() * 12 + (d.month0() as i32) + months;
    let year = total.div_euclid(12);
    let month0 = total.rem_euclid(12);
    let month = month0 + 1;
    let day = {
        let first_of_month = NaiveDate::from_ymd_opt(year, month as u32, 1);
        let last_day = match first_of_month {
            Some(_) => {
                // Last day of the target month
                if month == 12 {
                    31
                } else {
                    NaiveDate::from_ymd_opt(year, (month + 1) as u32, 1)
                        .unwrap()
                        .pred_opt()
                        .unwrap()
                        .day()
                }
            }
            None => 28,
        };
        d.day().min(last_day)
    };
    NaiveDate::from_ymd_opt(year, month as u32, day).unwrap()
}

/// Monthly income/expense summary over a date range.
#[utoipa::path(
    get,
    path = "/api/reports/monthly",
    tag = "Reports",
    params(
        ("start_year" = Option<i32>, Query, description = "Start year (default: 6 months ago)"),
        ("start_month" = Option<i32>, Query, description = "Start month 1-12"),
        ("end_year" = Option<i32>, Query, description = "End year (default: current)"),
        ("end_month" = Option<i32>, Query, description = "End month 1-12"),
        ("account_id" = Option<Uuid>, Query, description = "Restrict to a single source account (payment method) UUID"),
    ),
    responses(
        (status = 200, description = "Monthly income/expense summary", body = MonthlyReportResponse),
        (status = 400, description = "Invalid parameters"),
    ),
)]
pub async fn monthly_report(
    State(state): State<AppState>,
    Query(params): Query<MonthlyParams>,
) -> Result<Json<MonthlyReportResponse>, (StatusCode, Json<serde_json::Value>)> {
    let now = Utc::now().date_naive();
    let current = NaiveDate::from_ymd_opt(now.year(), now.month(), 1).unwrap();

    let end = match (params.end_year, params.end_month) {
        (Some(y), Some(m)) => {
            if !valid_month(m) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "end_month must be between 1 and 12" })),
                ));
            }
            NaiveDate::from_ymd_opt(y, m as u32, 1).unwrap()
        }
        _ => current,
    };

    let start = match (params.start_year, params.start_month) {
        (Some(y), Some(m)) => {
            if !valid_month(m) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "start_month must be between 1 and 12" })),
                ));
            }
            NaiveDate::from_ymd_opt(y, m as u32, 1).unwrap()
        }
        _ => add_months(end, -5), // Default: last 6 months inclusive
    };

    if start > end {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "start date must be before or equal to end date" })),
        ));
    }

    #[derive(sqlx::FromRow)]
    struct MonthlyRow {
        year: i32,
        month: i32,
        income_total: Decimal,
        expense_total: Decimal,
    }

    let rows: Vec<MonthlyRow> = sqlx::query_as(
        // Dates are evaluated through `effective_transaction_date` so the
        // card-expense dating preference applies here too; the `t.date` bounds
        // keep the scan narrow without changing the result (an effective date
        // is never earlier than its transaction, nor more than a cycle later).
        "SELECT EXTRACT(YEAR FROM effective_transaction_date(t.date, t.account_id, $4))::int AS year,
                EXTRACT(MONTH FROM effective_transaction_date(t.date, t.account_id, $4))::int AS month,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)::numeric AS income_total,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS expense_total
         FROM transactions t
         WHERE t.date >= $1 - INTERVAL '3 months'
           AND t.date < $2
           AND effective_transaction_date(t.date, t.account_id, $4) >= $1
           AND effective_transaction_date(t.date, t.account_id, $4) < $2
           AND ($3::uuid IS NULL OR t.account_id = $3)
         GROUP BY 1, 2
         ORDER BY 1, 2",
    )
    .bind(start)
    .bind(add_months(end, 1))
    .bind(params.account_id)
    .bind(settings::card_expense_dating(&state.pg_pool).await)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch monthly report: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch monthly report" })),
        )
    })?;

    // Fill in months with no transactions so the client can chart continuous months.
    let mut months = Vec::new();
    let mut cursor = start;
    while cursor <= end {
        let y = cursor.year();
        let m = cursor.month() as i32;
        if let Some(row) = rows.iter().find(|r| r.year == y && r.month == m) {
            months.push(MonthlyReportItem {
                year: y,
                month: m,
                income_total: row.income_total,
                expense_total: row.expense_total,
                balance: row.income_total - row.expense_total,
            });
        } else {
            months.push(MonthlyReportItem {
                year: y,
                month: m,
                income_total: Decimal::ZERO,
                expense_total: Decimal::ZERO,
                balance: Decimal::ZERO,
            });
        }
        cursor = add_months(cursor, 1);
    }

    Ok(Json(MonthlyReportResponse { months }))
}

/// Category spending breakdown for a date range.
#[utoipa::path(
    get,
    path = "/api/reports/category-breakdown",
    tag = "Reports",
    params(
        ("start_date" = Option<NaiveDate>, Query, description = "Start date (ISO). Default: first day of current month"),
        ("end_date" = Option<NaiveDate>, Query, description = "End date (ISO). Default: today"),
    ),
    responses(
        (status = 200, description = "Category spending breakdown", body = CategoryBreakdownResponse),
        (status = 400, description = "Invalid date range"),
    ),
)]
pub async fn category_breakdown(
    State(state): State<AppState>,
    Query(params): Query<BreakdownParams>,
) -> Result<Json<CategoryBreakdownResponse>, (StatusCode, Json<serde_json::Value>)> {
    let now = Utc::now().date_naive();
    let start_date = params.start_date.unwrap_or_else(|| month_start(now));
    let end_date = params.end_date.unwrap_or(now);

    if start_date > end_date {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "start_date must be before or equal to end_date" })),
        ));
    }

    #[derive(sqlx::FromRow)]
    struct BreakdownRow {
        category_id: Option<uuid::Uuid>,
        category_name: Option<String>,
        color: Option<String>,
        icon: Option<String>,
        total: Decimal,
        transaction_count: i64,
    }

    let rows: Vec<BreakdownRow> = sqlx::query_as(
        "SELECT t.category_id, c.name AS category_name, c.color, c.icon,
                COALESCE(SUM(t.amount), 0)::numeric AS total,
                COUNT(*)::bigint AS transaction_count
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.type = 'expense'
           AND t.date >= $1 - INTERVAL '3 months'
           AND effective_transaction_date(t.date, t.account_id, $3) >= $1
           AND effective_transaction_date(t.date, t.account_id, $3) <= $2
         GROUP BY t.category_id, c.name, c.color, c.icon
         ORDER BY total DESC",
    )
    .bind(start_date)
    .bind(end_date)
    .bind(settings::card_expense_dating(&state.pg_pool).await)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch category breakdown: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch category breakdown" })),
        )
    })?;

    let grand_total: Decimal = rows.iter().map(|r| r.total).sum();

    let categories = rows
        .into_iter()
        .map(|r| {
            let percentage = if grand_total > Decimal::ZERO {
                (r.total / grand_total) * Decimal::from(100)
            } else {
                Decimal::ZERO
            };
            CategoryBreakdownItem {
                category_id: r.category_id,
                category_name: r.category_name,
                color: r.color,
                icon: r.icon,
                total: r.total,
                percentage,
                transaction_count: r.transaction_count,
            }
        })
        .collect();

    Ok(Json(CategoryBreakdownResponse {
        categories,
        start_date,
        end_date,
    }))
}

/// Monthly trends (income, expense, net) over the last N months.
#[utoipa::path(
    get,
    path = "/api/reports/trends",
    tag = "Reports",
    params(
        ("months" = Option<i32>, Query, description = "Number of months (default 6, max 12)"),
    ),
    responses(
        (status = 200, description = "Monthly trends", body = TrendsResponse),
        (status = 400, description = "Invalid months parameter"),
    ),
)]
pub async fn trends(
    State(state): State<AppState>,
    Query(params): Query<TrendsParams>,
) -> Result<Json<TrendsResponse>, (StatusCode, Json<serde_json::Value>)> {
    let months = params.months.unwrap_or(6).clamp(1, 12);

    let now = Utc::now().date_naive();
    let end = month_start(now);
    let start = add_months(end, -(months - 1));

    #[derive(sqlx::FromRow)]
    struct TrendRow {
        year: i32,
        month: i32,
        income_total: Decimal,
        expense_total: Decimal,
    }

    let rows: Vec<TrendRow> = sqlx::query_as(
        "SELECT EXTRACT(YEAR FROM effective_transaction_date(t.date, t.account_id, $3))::int AS year,
                EXTRACT(MONTH FROM effective_transaction_date(t.date, t.account_id, $3))::int AS month,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)::numeric AS income_total,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS expense_total
         FROM transactions t
         WHERE t.date >= $1 - INTERVAL '3 months'
           AND t.date < $2
           AND effective_transaction_date(t.date, t.account_id, $3) >= $1
           AND effective_transaction_date(t.date, t.account_id, $3) < $2
         GROUP BY 1, 2
         ORDER BY 1, 2",
    )
    .bind(start)
    .bind(add_months(end, 1))
    .bind(settings::card_expense_dating(&state.pg_pool).await)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch trends: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch trends" })),
        )
    })?;

    let mut trends = Vec::new();
    let mut cursor = start;
    while cursor <= end {
        let y = cursor.year();
        let m = cursor.month() as i32;
        let label = format!("{:04}-{:02}", y, m);

        if let Some(row) = rows.iter().find(|r| r.year == y && r.month == m) {
            trends.push(TrendPoint {
                month_label: label,
                year: y,
                month: m,
                income_total: row.income_total,
                expense_total: row.expense_total,
                net: row.income_total - row.expense_total,
            });
        } else {
            trends.push(TrendPoint {
                month_label: label,
                year: y,
                month: m,
                income_total: Decimal::ZERO,
                expense_total: Decimal::ZERO,
                net: Decimal::ZERO,
            });
        }
        cursor = add_months(cursor, 1);
    }

    Ok(Json(TrendsResponse { trends }))
}
