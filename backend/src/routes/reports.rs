//! Reporting endpoints.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Datelike, Duration, NaiveDate, Utc, Weekday};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    CashFlowPoint, CashFlowResponse, CategoryBreakdownItem, CategoryBreakdownResponse,
    MonthlyReportItem, MonthlyReportResponse, TrendPoint, TrendsResponse,
};
use crate::routes::settings;
use crate::state::AppState;

/// Monthly-report filters.
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

/// Cash-flow chart filters.
#[derive(Debug, Deserialize)]
pub struct CashFlowParams {
    /// Start date (inclusive).
    pub start_date: Option<NaiveDate>,
    /// End date (inclusive).
    pub end_date: Option<NaiveDate>,
    /// Aggregation period: `day`, `week`, or `month`.
    pub granularity: Option<String>,
}

/// Category-breakdown filters.
#[derive(Debug, Default, Deserialize)]
pub struct BreakdownParams {
    /// Start date (ISO `YYYY-MM-DD`). Defaults to the first day of the current month.
    pub start_date: Option<NaiveDate>,
    /// End date (ISO `YYYY-MM-DD`). Defaults to today.
    pub end_date: Option<NaiveDate>,
}

/// Trends-report filters.
#[derive(Debug, Deserialize)]
pub struct TrendsParams {
    /// Number of months to include (default 6, max 12).
    pub months: Option<i32>,
}

/// Routes for reporting operations.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/reports/monthly", get(monthly_report))
        .route("/api/reports/cash-flow", get(cash_flow))
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

/// Returns the Monday of the ISO week containing `d`.
fn week_start(d: NaiveDate) -> NaiveDate {
    let days_from_monday = match d.weekday() {
        Weekday::Mon => 0,
        Weekday::Tue => 1,
        Weekday::Wed => 2,
        Weekday::Thu => 3,
        Weekday::Fri => 4,
        Weekday::Sat => 5,
        Weekday::Sun => 6,
    };
    d - Duration::days(days_from_monday)
}

/// Advances a chart period by one unit.
fn next_cash_flow_period(d: NaiveDate, granularity: &str) -> NaiveDate {
    match granularity {
        "day" => d + Duration::days(1),
        "week" => d + Duration::days(7),
        "month" => add_months(d, 1),
        _ => unreachable!("cash-flow granularity is validated before iteration"),
    }
}

/// Dashboard cash-flow totals grouped at the resolution needed by each chart view.
#[utoipa::path(
    get,
    path = "/api/reports/cash-flow",
    tag = "Reports",
    params(
        ("start_date" = Option<NaiveDate>, Query, description = "Start date (inclusive)"),
        ("end_date" = Option<NaiveDate>, Query, description = "End date (inclusive)"),
        ("granularity" = Option<String>, Query, description = "Aggregation: day, week, or month"),
    ),
    responses(
        (status = 200, description = "Cash-flow totals for the requested periods", body = CashFlowResponse),
        (status = 400, description = "Invalid date range or granularity"),
    ),
)]
pub async fn cash_flow(
    State(state): State<AppState>,
    Query(params): Query<CashFlowParams>,
) -> Result<Json<CashFlowResponse>, (StatusCode, Json<serde_json::Value>)> {
    let today = Utc::now().date_naive();
    let end_date = params.end_date.unwrap_or(today);
    let start_date = params.start_date.unwrap_or_else(|| month_start(end_date));
    let granularity = params.granularity.as_deref().unwrap_or("month");

    if start_date > end_date {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "start_date must be before or equal to end_date" })),
        ));
    }
    if !matches!(granularity, "day" | "week" | "month") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "granularity must be 'day', 'week', or 'month'" })),
        ));
    }

    #[derive(sqlx::FromRow)]
    struct CashFlowRow {
        period_start: NaiveDate,
        income_total: Decimal,
        expense_total: Decimal,
    }

    let rows: Vec<CashFlowRow> = sqlx::query_as(
        // The effective date applies the configured credit-card dating rule.
        // The raw transaction-date pre-filter keeps the date index useful while
        // allowing a card purchase to move into a later billing period.
        "SELECT date_trunc($1, effective_transaction_date(t.date, t.account_id, $4))::date AS period_start,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)::numeric AS income_total,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS expense_total
         FROM transactions t
         WHERE t.date >= $2 - INTERVAL '3 months'
           AND t.date <= $3
           AND effective_transaction_date(t.date, t.account_id, $4) >= $2
           AND effective_transaction_date(t.date, t.account_id, $4) <= $3
         GROUP BY 1
         ORDER BY 1",
    )
    .bind(granularity)
    .bind(start_date)
    .bind(end_date)
    .bind(settings::card_expense_dating(&state.pg_pool).await)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch cash-flow report: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch cash-flow report" })),
        )
    })?;

    let first_period = match granularity {
        "day" => start_date,
        "week" => week_start(start_date),
        "month" => month_start(start_date),
        _ => unreachable!(),
    };
    let last_period = match granularity {
        "day" => end_date,
        "week" => week_start(end_date),
        "month" => month_start(end_date),
        _ => unreachable!(),
    };

    let mut points = Vec::new();
    let mut cursor = first_period;
    while cursor <= last_period {
        let row = rows.iter().find(|row| row.period_start == cursor);
        let income_total = row.map(|row| row.income_total).unwrap_or(Decimal::ZERO);
        let expense_total = row.map(|row| row.expense_total).unwrap_or(Decimal::ZERO);
        points.push(CashFlowPoint {
            period_start: cursor,
            income_total,
            expense_total,
            balance: income_total - expense_total,
        });
        cursor = next_cash_flow_period(cursor, granularity);
    }

    Ok(Json(CashFlowResponse { points }))
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

#[cfg(test)]
mod tests {
    use super::{next_cash_flow_period, week_start};
    use chrono::NaiveDate;

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn week_starts_on_monday() {
        assert_eq!(week_start(date("2026-09-14")), date("2026-09-14"));
        assert_eq!(week_start(date("2026-09-20")), date("2026-09-14"));
    }

    #[test]
    fn cash_flow_periods_advance_by_their_granularity() {
        assert_eq!(
            next_cash_flow_period(date("2026-09-14"), "day"),
            date("2026-09-15")
        );
        assert_eq!(
            next_cash_flow_period(date("2026-09-14"), "week"),
            date("2026-09-21")
        );
        assert_eq!(
            next_cash_flow_period(date("2026-09-01"), "month"),
            date("2026-10-01")
        );
    }
}
