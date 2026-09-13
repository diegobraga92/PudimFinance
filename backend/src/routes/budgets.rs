//! Budget CRUD endpoints.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Datelike, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    AcknowledgeAlertsResponse, BudgetAlert, BudgetAlertListResponse, BudgetListResponse,
    BudgetSummaryItem, BudgetSummaryResponse, BudgetWithCategory, CreateBudgetRequest,
};
use crate::state::AppState;

/// Query parameters for the budget list and summary.
#[derive(Debug, Default, Deserialize)]
pub struct BudgetParams {
    /// Year (defaults to the current year).
    pub year: Option<i32>,
    /// Month from 1 to 12 (defaults to the current month).
    pub month: Option<i32>,
}

/// Query parameters for the budget alerts listing.
#[derive(Debug, Default, Deserialize)]
pub struct BudgetAlertParams {
    /// Year (defaults to the current year).
    pub year: Option<i32>,
    /// Month from 1 to 12 (defaults to the current month).
    pub month: Option<i32>,
    /// Filter by acknowledgement state. Defaults to false, unacknowledged only.
    pub acknowledged: Option<bool>,
    /// Page offset (default 0).
    pub page: Option<u32>,
    /// Page size (default 50, max 200).
    pub page_size: Option<u32>,
}

/// Returns a sub-router with all budget routes mounted under `/api/budgets`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/budgets", get(list_budgets).post(create_budget))
        .route("/api/budgets/summary", get(budget_summary))
        .route("/api/budgets/alerts", get(list_budget_alerts))
        .route(
            "/api/budgets/alerts/acknowledge-all",
            axum::routing::post(acknowledge_all_alerts),
        )
        .route(
            "/api/budgets/alerts/{id}/acknowledge",
            axum::routing::post(acknowledge_alert),
        )
        .route("/api/budgets/{id}", axum::routing::delete(delete_budget))
}

/// Resolves year/month from query params, defaulting to the current month.
fn resolve_period(
    params: &BudgetParams,
) -> Result<(i32, i32), (StatusCode, Json<serde_json::Value>)> {
    let now = Utc::now();
    let year = params.year.unwrap_or_else(|| now.year());
    let month = params.month.unwrap_or_else(|| now.month() as i32);

    if !(1..=12).contains(&month) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "month must be between 1 and 12" })),
        ));
    }

    Ok((year, month))
}

/// Lists budgets for a given month/year, joined with category display info.
#[utoipa::path(
    get,
    path = "/api/budgets",
    tag = "Budgets",
    params(
        ("year" = Option<i32>, Query, description = "Year (default: current)"),
        ("month" = Option<i32>, Query, description = "Month 1-12 (default: current)"),
    ),
    responses(
        (status = 200, description = "List of budgets for the period", body = BudgetListResponse),
        (status = 400, description = "Invalid month parameter"),
    ),
)]
pub async fn list_budgets(
    State(state): State<AppState>,
    Query(params): Query<BudgetParams>,
) -> Result<Json<BudgetListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let (year, month) = resolve_period(&params)?;

    let items: Vec<BudgetWithCategory> = sqlx::query_as(
        "SELECT b.id, b.category_id, c.name AS category_name,
                c.icon, c.color, b.month::int, b.year::int, b.amount_limit
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
         WHERE b.year = $1 AND b.month = $2
         ORDER BY c.name",
    )
    .bind(year)
    .bind(month)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list budgets: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch budgets" })),
        )
    })?;

    Ok(Json(BudgetListResponse { items, month, year }))
}

/// Creates or updates a budget (upsert on (category_id, month, year)).
#[utoipa::path(
    post,
    path = "/api/budgets",
    tag = "Budgets",
    request_body = CreateBudgetRequest,
    responses(
        (status = 201, description = "Budget created", body = BudgetWithCategory),
        (status = 200, description = "Budget updated", body = BudgetWithCategory),
        (status = 400, description = "Invalid budget payload"),
    ),
)]
pub async fn create_budget(
    State(state): State<AppState>,
    Json(payload): Json<CreateBudgetRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if !(1..=12).contains(&payload.month) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "month must be between 1 and 12" })),
        ));
    }
    if payload.amount_limit <= Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "amount_limit must be greater than zero" })),
        ));
    }

    let category_type: Option<String> =
        sqlx::query_scalar("SELECT type FROM categories WHERE id = $1")
            .bind(payload.category_id)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to check category: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to validate category" })),
                )
            })?;

    let cat_type = match category_type {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "category_id does not reference an existing category" })),
            ))
        }
    };
    if cat_type != "expense" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "budgets can only be created for expense categories" })),
        ));
    }

    let category = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<String>)>(
        "SELECT id, name, icon, color FROM categories WHERE id = $1",
    )
    .bind(payload.category_id)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch category info: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch category info" })),
        )
    })?;

    // Upsert on (category_id, month, year). Creates when missing, updates otherwise.
    let inserted = sqlx::query_scalar::<_, bool>(
        "INSERT INTO budgets (category_id, month, year, amount_limit)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (category_id, month, year) DO UPDATE
         SET amount_limit = EXCLUDED.amount_limit, updated_at = NOW()
         RETURNING (xmax = 0) AS inserted",
    )
    .bind(payload.category_id)
    .bind(payload.month)
    .bind(payload.year)
    .bind(payload.amount_limit)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to upsert budget: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create/update budget" })),
        )
    })?;

    let id: Uuid = sqlx::query_scalar(
        "SELECT id FROM budgets WHERE category_id = $1 AND month = $2 AND year = $3",
    )
    .bind(payload.category_id)
    .bind(payload.month)
    .bind(payload.year)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch budget id: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch budget" })),
        )
    })?;

    let budget = BudgetWithCategory {
        id,
        category_id: category.0,
        category_name: category.1,
        icon: category.2,
        color: category.3,
        month: payload.month,
        year: payload.year,
        amount_limit: payload.amount_limit,
    };

    let status = if inserted {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };

    Ok((status, Json(budget)))
}

/// Lists budget alerts with optional period and acknowledgement filters.
#[utoipa::path(
    get,
    path = "/api/budgets/alerts",
    tag = "Budgets",
    params(
        ("year" = Option<i32>, Query, description = "Year (default: current)"),
        ("month" = Option<i32>, Query, description = "Month 1-12 (default: current)"),
        ("acknowledged" = Option<bool>, Query, description = "Filter by acknowledgement state (default: false)"),
        ("page" = Option<u32>, Query, description = "Page offset (default 0)"),
        ("page_size" = Option<u32>, Query, description = "Page size (default 50, max 200)"),
    ),
    responses(
        (status = 200, description = "List of budget alerts", body = BudgetAlertListResponse),
        (status = 400, description = "Invalid month parameter"),
    ),
)]
pub async fn list_budget_alerts(
    State(state): State<AppState>,
    Query(params): Query<BudgetAlertParams>,
) -> Result<Json<BudgetAlertListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let now = Utc::now();
    let year = params.year.unwrap_or_else(|| now.year());
    let month = params.month.unwrap_or_else(|| now.month() as i32);

    if !(1..=12).contains(&month) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "month must be between 1 and 12" })),
        ));
    }

    let acknowledged = params.acknowledged.unwrap_or(false);
    let page_size = params.page_size.unwrap_or(50).clamp(1, 200);
    let offset = params.page.unwrap_or(0).saturating_mul(page_size);

    let items: Vec<BudgetAlert> = sqlx::query_as(
        "SELECT ba.id, ba.budget_id, ba.category_id,
                c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
                b.amount_limit, ba.actual_spent, ba.threshold,
                ba.triggered_at, ba.acknowledged,
                COALESCE(ba.year, b.year)::int AS year, COALESCE(ba.month, b.month)::int AS month
         FROM budget_alerts ba
         JOIN budgets b ON b.id = ba.budget_id
         LEFT JOIN categories c ON c.id = COALESCE(ba.category_id, b.category_id)
         WHERE (ba.year IS NULL OR ba.year = $1)
           AND (ba.month IS NULL OR ba.month = $2)
           AND ba.acknowledged = $3
         ORDER BY ba.triggered_at DESC
         LIMIT $4 OFFSET $5",
    )
    .bind(year)
    .bind(month)
    .bind(acknowledged)
    .bind(page_size as i64)
    .bind(offset as i64)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list budget alerts: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch budget alerts" })),
        )
    })?;

    let unacknowledged_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM budget_alerts WHERE acknowledged = false")
            .fetch_one(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to count budget alerts: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to count budget alerts" })),
                )
            })?;

    Ok(Json(BudgetAlertListResponse {
        items,
        unacknowledged_count: unacknowledged_count.0,
    }))
}

/// Acknowledges a single budget alert by ID.
#[utoipa::path(
    post,
    path = "/api/budgets/alerts/{id}/acknowledge",
    tag = "Budgets",
    params(
        ("id" = Uuid, Path, description = "Budget alert UUID"),
    ),
    responses(
        (status = 200, description = "Alert acknowledged"),
        (status = 404, description = "Alert not found"),
    ),
)]
pub async fn acknowledge_alert(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let result = sqlx::query("UPDATE budget_alerts SET acknowledged = true WHERE id = $1")
        .bind(id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to acknowledge alert {}: {}", id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to acknowledge alert" })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Budget alert not found" })),
        ));
    }

    Ok(Json(json!({ "id": id, "acknowledged": true })))
}

/// Acknowledges all unacknowledged alerts for a given period (or all periods).
#[utoipa::path(
    post,
    path = "/api/budgets/alerts/acknowledge-all",
    tag = "Budgets",
    responses(
        (status = 200, description = "Alerts acknowledged", body = AcknowledgeAlertsResponse),
    ),
)]
pub async fn acknowledge_all_alerts(
    State(state): State<AppState>,
    Query(params): Query<BudgetAlertParams>,
) -> Result<Json<AcknowledgeAlertsResponse>, (StatusCode, Json<serde_json::Value>)> {
    let now = Utc::now();
    let year = params.year.unwrap_or_else(|| now.year());
    let month = params.month.unwrap_or_else(|| now.month() as i32);

    if !(1..=12).contains(&month) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "month must be between 1 and 12" })),
        ));
    }

    let result = sqlx::query(
        "UPDATE budget_alerts
         SET acknowledged = true
         WHERE acknowledged = false
           AND (year IS NULL OR year = $1)
           AND (month IS NULL OR month = $2)",
    )
    .bind(year)
    .bind(month)
    .execute(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to acknowledge all alerts: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to acknowledge alerts" })),
        )
    })?;

    Ok(Json(AcknowledgeAlertsResponse {
        acknowledged: result.rows_affected() as i64,
    }))
}

/// Returns budget vs actual spending for a given month/year.
#[utoipa::path(
    get,
    path = "/api/budgets/summary",
    tag = "Budgets",
    params(
        ("year" = Option<i32>, Query, description = "Year (default: current)"),
        ("month" = Option<i32>, Query, description = "Month 1-12 (default: current)"),
    ),
    responses(
        (status = 200, description = "Budget vs actual summary", body = BudgetSummaryResponse),
        (status = 400, description = "Invalid month parameter"),
    ),
)]
pub async fn budget_summary(
    State(state): State<AppState>,
    Query(params): Query<BudgetParams>,
) -> Result<Json<BudgetSummaryResponse>, (StatusCode, Json<serde_json::Value>)> {
    let (year, month) = resolve_period(&params)?;

    // Fetch each budget joined with category, plus actual spending for the month.
    #[derive(sqlx::FromRow)]
    struct BudgetRow {
        id: Uuid,
        category_id: Uuid,
        category_name: String,
        icon: Option<String>,
        color: Option<String>,
        month: i32,
        year: i32,
        amount_limit: Decimal,
        actual_spent: Option<Decimal>,
    }

    let rows: Vec<BudgetRow> = sqlx::query_as(
        "SELECT b.id, b.category_id, c.name AS category_name,
                c.icon, c.color, b.month::int, b.year::int, b.amount_limit,
                (SELECT COALESCE(SUM(t.amount), 0)::numeric
                 FROM transactions t
                 WHERE t.category_id = b.category_id
                   AND t.type = 'expense'
                   AND EXTRACT(YEAR FROM t.date)::int = b.year
                   AND EXTRACT(MONTH FROM t.date)::int = b.month) AS actual_spent
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
         WHERE b.year = $1 AND b.month = $2
         ORDER BY c.name",
    )
    .bind(year)
    .bind(month)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch budget summary: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch budget summary" })),
        )
    })?;

    let mut items = Vec::with_capacity(rows.len());
    let mut total_budgeted = Decimal::ZERO;
    let mut total_spent = Decimal::ZERO;

    for row in rows {
        let actual = row.actual_spent.unwrap_or_default();
        let percentage = if row.amount_limit > Decimal::ZERO {
            (actual / row.amount_limit) * Decimal::from(100)
        } else {
            Decimal::ZERO
        };
        let remaining = row.amount_limit - actual;

        total_budgeted += row.amount_limit;
        total_spent += actual;

        items.push(BudgetSummaryItem {
            budget: BudgetWithCategory {
                id: row.id,
                category_id: row.category_id,
                category_name: row.category_name,
                icon: row.icon,
                color: row.color,
                month: row.month,
                year: row.year,
                amount_limit: row.amount_limit,
            },
            actual_spent: actual,
            percentage,
            remaining,
        });
    }

    // Generate budget alerts for budgets that crossed the 80% threshold and
    // don't already have an unacknowledged alert for this period.
    for item in &items {
        if item.percentage >= Decimal::from(80) {
            let budget_id = item.budget.id;
            // Only insert when no unacknowledged alert exists for this budget.
            let existing: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM budget_alerts
                 WHERE budget_id = $1 AND acknowledged = false
                 LIMIT 1",
            )
            .bind(budget_id)
            .fetch_optional(&state.pg_pool)
            .await
            .ok()
            .flatten();

            if existing.is_none() {
                let _ = sqlx::query(
                    "INSERT INTO budget_alerts
                        (budget_id, actual_spent, threshold, acknowledged,
                         category_id, year, month)
                     VALUES ($1, $2, $3, false, $4, $5, $6)",
                )
                .bind(budget_id)
                .bind(item.actual_spent)
                .bind(Decimal::from(80))
                .bind(item.budget.category_id)
                .bind(year)
                .bind(month)
                .execute(&state.pg_pool)
                .await
                .map_err(|e| error!("Failed to insert budget alert: {}", e));
            }
        }
    }

    Ok(Json(BudgetSummaryResponse {
        items,
        total_budgeted,
        total_spent,
        month,
        year,
    }))
}

/// Deletes a budget by ID.
#[utoipa::path(
    delete,
    path = "/api/budgets/{id}",
    tag = "Budgets",
    params(
        ("id" = Uuid, Path, description = "Budget UUID"),
    ),
    responses(
        (status = 204, description = "Budget deleted"),
        (status = 404, description = "Budget not found"),
    ),
)]
pub async fn delete_budget(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let result = sqlx::query("DELETE FROM budgets WHERE id = $1")
        .bind(id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to delete budget {}: {}", id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete budget" })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Budget not found" })),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}
