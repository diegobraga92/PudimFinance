//! Installment plans that split a purchase into monthly payments.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::json;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    CreateInstallmentPlanRequest, GenerateInstallmentsResponse, InstallmentPlan,
    InstallmentPlanDetail, InstallmentProgress, InstallmentTransaction, PayInstallmentResponse,
    Transaction,
};
use crate::state::AppState;

/// Routes for installment operations.
pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/installments",
            get(list_installment_plans).post(create_installment_plan),
        )
        .route(
            "/api/installments/{id}/generate",
            axum::routing::post(generate_installments),
        )
        .route(
            "/api/installments/{id}/installment/{number}/pay",
            axum::routing::post(pay_installment),
        )
        .route(
            "/api/installments/{id}",
            get(get_installment_plan).delete(delete_installment_plan),
        )
}

/// Adds `months` to a date, clamping the day to the last valid day of the target month.
fn add_months(d: NaiveDate, months: i32) -> NaiveDate {
    let total = d.year() * 12 + (d.month0() as i32) + months;
    let year = total.div_euclid(12);
    let month0 = total.rem_euclid(12);
    let month = month0 + 1;
    let day = d.day();
    let first_of_month = NaiveDate::from_ymd_opt(year, month as u32, 1);
    let max_day = match first_of_month {
        Some(_) => {
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
    NaiveDate::from_ymd_opt(year, month as u32, day.min(max_day)).unwrap()
}
/// Lists all installment plans with computed progress.
#[utoipa::path(
    get,
    path = "/api/installments",
    tag = "Installments",
    responses(
        (status = 200, description = "List of installment plans", body = [InstallmentPlan]),
    ),
)]
pub async fn list_installment_plans(
    State(state): State<AppState>,
) -> Result<Json<Vec<InstallmentPlan>>, (StatusCode, Json<serde_json::Value>)> {
    #[derive(sqlx::FromRow)]
    struct PlanRow {
        id: Uuid,
        description: String,
        total_amount: Decimal,
        installments: i32,
        installment_amount: Decimal,
        category_id: Option<Uuid>,
        category_name: Option<String>,
        category_icon: Option<String>,
        category_color: Option<String>,
        account_id: Option<Uuid>,
        start_date: NaiveDate,
        created_at: chrono::DateTime<Utc>,
        paid_count: i64,
        pending_count: i64,
        paid_amount: Decimal,
    }

    let rows: Vec<PlanRow> = sqlx::query_as(
        "SELECT ip.id, ip.description, ip.total_amount, ip.installments,
                ip.installment_amount, ip.category_id,
                c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
                ip.account_id, ip.start_date, ip.created_at,
                COALESCE(SUM(CASE WHEN it.status = 'paid' OR it.anticipated_at IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS paid_count,
                COALESCE(SUM(CASE WHEN it.status <> 'paid' AND it.anticipated_at IS NULL THEN 1 ELSE 0 END), 0)::bigint AS pending_count,
                COALESCE(SUM(CASE WHEN it.status = 'paid' OR it.anticipated_at IS NOT NULL THEN ip.installment_amount ELSE 0 END), 0)::numeric AS paid_amount
         FROM installment_plans ip
         LEFT JOIN installment_transactions it ON it.plan_id = ip.id
         LEFT JOIN categories c ON c.id = ip.category_id
         GROUP BY ip.id, c.name, c.icon, c.color
         ORDER BY ip.start_date DESC, ip.created_at DESC",
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list installment plans: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch installment plans" })),
        )
    })?;

    let plans = rows
        .into_iter()
        .map(|r| InstallmentPlan {
            id: r.id,
            description: r.description,
            total_amount: r.total_amount,
            installments: r.installments,
            installment_amount: r.installment_amount,
            category_id: r.category_id,
            category_name: r.category_name,
            category_icon: r.category_icon,
            category_color: r.category_color,
            account_id: r.account_id,
            start_date: r.start_date,
            created_at: r.created_at,
            progress: InstallmentProgress {
                paid_count: r.paid_count,
                pending_count: r.pending_count,
                total_count: r.installments as i64,
                paid_amount: r.paid_amount,
                remaining_amount: r.total_amount - r.paid_amount,
            },
        })
        .collect();

    Ok(Json(plans))
}

/// Creates a new installment plan (no transactions are created yet).
#[utoipa::path(
    post,
    path = "/api/installments",
    tag = "Installments",
    request_body = CreateInstallmentPlanRequest,
    responses(
        (status = 201, description = "Installment plan created", body = InstallmentPlan),
        (status = 400, description = "Invalid installment payload"),
    ),
)]
pub async fn create_installment_plan(
    State(state): State<AppState>,
    Json(payload): Json<CreateInstallmentPlanRequest>,
) -> Result<(StatusCode, Json<InstallmentPlan>), (StatusCode, Json<serde_json::Value>)> {
    if payload.description.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "description must not be empty" })),
        ));
    }
    if payload.total_amount <= Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "total_amount must be greater than zero" })),
        ));
    }
    if !(2..=60).contains(&payload.installments) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "installments must be between 2 and 60" })),
        ));
    }

    let installment_amount = payload.total_amount / Decimal::from(payload.installments);

    if let Some(aid) = payload.account_id {
        let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM accounts WHERE id = $1")
            .bind(aid)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to validate account: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to validate account" })),
                )
            })?;

        if exists.is_none() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "account_id does not reference an existing account" })),
            ));
        }
    }

    #[derive(sqlx::FromRow)]
    struct Inserted {
        id: Uuid,
        created_at: chrono::DateTime<Utc>,
    }
    let inserted: Inserted = sqlx::query_as(
        "INSERT INTO installment_plans
            (description, total_amount, installments, installment_amount, category_id, start_date, account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at",
    )
    .bind(payload.description.trim())
    .bind(payload.total_amount)
    .bind(payload.installments)
    .bind(installment_amount)
    .bind(payload.category_id)
    .bind(payload.start_date)
    .bind(payload.account_id)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to create installment plan: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create installment plan" })),
        )
    })?;

    for n in 1..=payload.installments {
        let due = add_months(payload.start_date, n - 1);
        let _ = sqlx::query(
            "INSERT INTO installment_transactions (plan_id, installment_number, due_date)
             VALUES ($1, $2, $3)",
        )
        .bind(inserted.id)
        .bind(n)
        .bind(due)
        .execute(&state.pg_pool)
        .await;
    }

    Ok((
        StatusCode::CREATED,
        Json(InstallmentPlan {
            id: inserted.id,
            description: payload.description.trim().to_string(),
            total_amount: payload.total_amount,
            installments: payload.installments,
            installment_amount,
            category_id: payload.category_id,
            category_name: None,
            category_icon: None,
            category_color: None,
            account_id: payload.account_id,
            start_date: payload.start_date,
            created_at: inserted.created_at,
            progress: InstallmentProgress {
                paid_count: 0,
                pending_count: payload.installments as i64,
                total_count: payload.installments as i64,
                paid_amount: Decimal::ZERO,
                remaining_amount: payload.total_amount,
            },
        }),
    ))
}

/// Returns a single installment plan with all its installment rows.
#[utoipa::path(
    get,
    path = "/api/installments/{id}",
    tag = "Installments",
    params(
        ("id" = Uuid, Path, description = "Installment plan UUID"),
    ),
    responses(
        (status = 200, description = "Installment plan detail", body = InstallmentPlanDetail),
        (status = 404, description = "Installment plan not found"),
    ),
)]
pub async fn get_installment_plan(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<InstallmentPlanDetail>, (StatusCode, Json<serde_json::Value>)> {
    #[derive(sqlx::FromRow)]
    struct PlanRow {
        id: Uuid,
        description: String,
        total_amount: Decimal,
        installments: i32,
        installment_amount: Decimal,
        category_id: Option<Uuid>,
        category_name: Option<String>,
        category_icon: Option<String>,
        category_color: Option<String>,
        account_id: Option<Uuid>,
        start_date: NaiveDate,
        created_at: chrono::DateTime<Utc>,
        paid_count: i64,
        pending_count: i64,
        paid_amount: Decimal,
    }

    let row: Option<PlanRow> = sqlx::query_as(
        "SELECT ip.id, ip.description, ip.total_amount, ip.installments,
                ip.installment_amount, ip.category_id,
                c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
                ip.account_id, ip.start_date, ip.created_at,
                COALESCE(SUM(CASE WHEN it.status = 'paid' OR it.anticipated_at IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS paid_count,
                COALESCE(SUM(CASE WHEN it.status <> 'paid' AND it.anticipated_at IS NULL THEN 1 ELSE 0 END), 0)::bigint AS pending_count,
                COALESCE(SUM(CASE WHEN it.status = 'paid' OR it.anticipated_at IS NOT NULL THEN ip.installment_amount ELSE 0 END), 0)::numeric AS paid_amount
         FROM installment_plans ip
         LEFT JOIN installment_transactions it ON it.plan_id = ip.id
         LEFT JOIN categories c ON c.id = ip.category_id
         WHERE ip.id = $1
         GROUP BY ip.id, c.name, c.icon, c.color",
    )
    .bind(id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch installment plan {}: {}", id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch installment plan" })),
        )
    })?;

    let row = match row {
        Some(r) => r,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Installment plan not found" })),
            ))
        }
    };

    let installments: Vec<InstallmentTransaction> = sqlx::query_as(
        "SELECT id, plan_id, installment_number, due_date, transaction_id, status,
                anticipated_at, anticipated_bill_id
         FROM installment_transactions
         WHERE plan_id = $1
         ORDER BY installment_number",
    )
    .bind(id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch installments: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch installments" })),
        )
    })?;

    Ok(Json(InstallmentPlanDetail {
        plan: InstallmentPlan {
            id: row.id,
            description: row.description,
            total_amount: row.total_amount,
            installments: row.installments,
            installment_amount: row.installment_amount,
            category_id: row.category_id,
            category_name: row.category_name,
            category_icon: row.category_icon,
            category_color: row.category_color,
            account_id: row.account_id,
            start_date: row.start_date,
            created_at: row.created_at,
            progress: InstallmentProgress {
                paid_count: row.paid_count,
                pending_count: row.pending_count,
                total_count: row.installments as i64,
                paid_amount: row.paid_amount,
                remaining_amount: row.total_amount - row.paid_amount,
            },
        },
        installments,
    }))
}

/// Deletes an installment plan (and any transactions it generated).
#[utoipa::path(
    delete,
    path = "/api/installments/{id}",
    tag = "Installments",
    params(
        ("id" = Uuid, Path, description = "Installment plan UUID"),
    ),
    responses(
        (status = 204, description = "Installment plan deleted"),
        (status = 404, description = "Installment plan not found"),
    ),
)]
pub async fn delete_installment_plan(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    // The FK from transactions.installment_plan_id has no ON DELETE CASCADE, so
    // clear the link on any generated transactions first, then delete the plan
    // (cascades to installment_transactions).
    let _ = sqlx::query(
        "UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id = $1",
    )
    .bind(id)
    .execute(&state.pg_pool)
    .await;

    let result = sqlx::query("DELETE FROM installment_plans WHERE id = $1")
        .bind(id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to delete installment plan {}: {}", id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete installment plan" })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Installment plan not found" })),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Generates transaction rows for all pending installments with due_date <= today.
#[utoipa::path(
    post,
    path = "/api/installments/{id}/generate",
    tag = "Installments",
    params(
        ("id" = Uuid, Path, description = "Installment plan UUID"),
    ),
    responses(
        (status = 200, description = "Installments generated", body = GenerateInstallmentsResponse),
        (status = 404, description = "Installment plan not found"),
    ),
)]
pub async fn generate_installments(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<GenerateInstallmentsResponse>, (StatusCode, Json<serde_json::Value>)> {
    #[derive(sqlx::FromRow)]
    struct PendingRow {
        id: Uuid,
        installment_number: i32,
        due_date: NaiveDate,
        plan_description: String,
        installments_total: i32,
        installment_amount: Decimal,
        category_id: Option<Uuid>,
        account_id: Option<Uuid>,
    }

    let today = Utc::now().date_naive();

    let pending: Vec<PendingRow> = sqlx::query_as(
        "SELECT it.id, it.installment_number, it.due_date,
                ip.description AS plan_description, ip.installments AS installments_total,
                ip.installment_amount, ip.category_id, ip.account_id
         FROM installment_transactions it
         JOIN installment_plans ip ON ip.id = it.plan_id
         WHERE it.plan_id = $1
           AND it.status = 'pending'
           AND it.anticipated_at IS NULL
           AND it.due_date <= $2
         ORDER BY it.installment_number",
    )
    .bind(id)
    .bind(today)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list pending installments: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list pending installments" })),
        )
    })?;

    let mut generated: i64 = 0;
    let mut already_generated: i64 = 0;

    for row in pending {
        let existing: Option<Uuid> =
            sqlx::query_scalar("SELECT transaction_id FROM installment_transactions WHERE id = $1")
                .bind(row.id)
                .fetch_one(&state.pg_pool)
                .await
                .ok()
                .flatten();

        if existing.is_some() {
            already_generated += 1;
            continue;
        }

        let description = format!(
            "Parcela {}/{} — {}",
            row.installment_number, row.installments_total, row.plan_description
        );

        // Resolve the payment and posting accounts (defaults to Cash).
        let source_account =
            crate::transaction_ledger::resolve_source_account(&state.pg_pool, row.account_id)
                .await
                .map_err(|e| {
                    error!("Failed to resolve source account: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to create installment transaction" })),
                    )
                })?;
        let source_name = crate::transaction_ledger::account_name(&state.pg_pool, source_account)
            .await
            .map_err(|e| {
                error!("Failed to load source account name: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to create installment transaction" })),
                )
            })?;
        let posting_account = crate::transaction_ledger::resolve_posting_account(
            &state.pg_pool,
            row.category_id,
            "expense",
        )
        .await
        .map_err(|e| {
            error!("Failed to resolve posting account: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment transaction" })),
            )
        })?;
        let posting_name = crate::transaction_ledger::account_name(&state.pg_pool, posting_account)
            .await
            .map_err(|e| {
                error!("Failed to load posting account name: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to create installment transaction" })),
                )
            })?;

        let mut db = state.pg_pool.begin().await.map_err(|e| {
            error!("Failed to begin DB transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment transaction" })),
            )
        })?;

        let tx: Transaction = sqlx::query_as(
            "INSERT INTO transactions
                (description, amount, type, category_id, date, installment_plan_id, account_id)
             VALUES ($1, $2, 'expense', $3, $4, $5, $6)
             RETURNING id, description, amount, type, category_id, date, notes,
                       installment_plan_id, account_id, created_at, updated_at",
        )
        .bind(&description)
        .bind(row.installment_amount)
        .bind(row.category_id)
        .bind(row.due_date)
        .bind(id)
        .bind(source_account)
        .fetch_one(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to create installment transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment transaction" })),
            )
        })?;

        // Post the balanced ledger pair and link it to this transaction.
        crate::transaction_ledger::post_entries(
            &mut *db,
            tx.id,
            "expense",
            posting_account,
            &posting_name,
            source_account,
            &source_name,
            tx.amount,
            &tx.description,
        )
        .await
        .map_err(|e| {
            error!("Failed to post ledger entries: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment transaction" })),
            )
        })?;

        sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
            .bind(tx.id)
            .execute(&mut *db)
            .await
            .map_err(|e| {
                error!("Failed to link ledger entries: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to create installment transaction" })),
                )
            })?;

        // Link the transaction and mark the installment as generated.
        sqlx::query(
            "UPDATE installment_transactions
             SET transaction_id = $1, status = 'generated'
             WHERE id = $2",
        )
        .bind(tx.id)
        .bind(row.id)
        .execute(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to link installment transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to link installment transaction" })),
            )
        })?;

        db.commit().await.map_err(|e| {
            error!("Failed to commit DB transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment transaction" })),
            )
        })?;

        generated += 1;
    }

    Ok(Json(GenerateInstallmentsResponse {
        generated,
        already_generated,
    }))
}

/// Marks a single installment as paid, creating the transaction if needed.
#[utoipa::path(
    post,
    path = "/api/installments/{id}/installment/{number}/pay",
    tag = "Installments",
    params(
        ("id" = Uuid, Path, description = "Installment plan UUID"),
        ("number" = i32, Path, description = "1-based installment number"),
    ),
    responses(
        (status = 200, description = "Installment paid", body = PayInstallmentResponse),
        (status = 404, description = "Installment not found"),
    ),
)]
pub async fn pay_installment(
    State(state): State<AppState>,
    Path((id, number)): Path<(Uuid, i32)>,
) -> Result<Json<PayInstallmentResponse>, (StatusCode, Json<serde_json::Value>)> {
    #[derive(sqlx::FromRow)]
    struct InstRow {
        row_id: Uuid,
        transaction_id: Option<Uuid>,
        due_date: NaiveDate,
        plan_description: String,
        installments_total: i32,
        installment_amount: Decimal,
        category_id: Option<Uuid>,
        account_id: Option<Uuid>,
        anticipated_at: Option<chrono::DateTime<Utc>>,
    }

    let row: Option<InstRow> = sqlx::query_as(
        "SELECT it.id AS row_id, it.transaction_id, it.due_date, it.anticipated_at,
                ip.description AS plan_description, ip.installments AS installments_total,
                ip.installment_amount, ip.category_id, ip.account_id
         FROM installment_transactions it
         JOIN installment_plans ip ON ip.id = it.plan_id
         WHERE it.plan_id = $1 AND it.installment_number = $2",
    )
    .bind(id)
    .bind(number)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch installment: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch installment" })),
        )
    })?;

    let row = match row {
        Some(r) => r,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Installment not found" })),
            ))
        }
    };

    if row.anticipated_at.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Installment was already anticipated" })),
        ));
    }

    // Resolve the payment and posting accounts (defaults to Cash).
    let source_account =
        crate::transaction_ledger::resolve_source_account(&state.pg_pool, row.account_id)
            .await
            .map_err(|e| {
                error!("Failed to resolve source account: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to pay installment" })),
                )
            })?;
    let source_name = crate::transaction_ledger::account_name(&state.pg_pool, source_account)
        .await
        .map_err(|e| {
            error!("Failed to load source account name: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to pay installment" })),
            )
        })?;
    let posting_account = crate::transaction_ledger::resolve_posting_account(
        &state.pg_pool,
        row.category_id,
        "expense",
    )
    .await
    .map_err(|e| {
        error!("Failed to resolve posting account: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to pay installment" })),
        )
    })?;
    let posting_name = crate::transaction_ledger::account_name(&state.pg_pool, posting_account)
        .await
        .map_err(|e| {
            error!("Failed to load posting account name: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to pay installment" })),
            )
        })?;

    let mut db = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to pay installment" })),
        )
    })?;

    let (tx, created) = if let Some(tx_id) = row.transaction_id {
        // Reuse the existing linked transaction.
        let tx: Option<Transaction> = sqlx::query_as(
            "SELECT id, description, amount, type, category_id, date, notes,
                    installment_plan_id, account_id, created_at, updated_at
             FROM transactions WHERE id = $1",
        )
        .bind(tx_id)
        .fetch_optional(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to fetch linked transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch linked transaction" })),
            )
        })?;

        match tx {
            Some(t) => {
                // Backfill ledger entries for transactions predating unified posting.
                let linked: Option<Uuid> = sqlx::query_scalar(
                    "SELECT ledger_transaction_id FROM transactions WHERE id = $1",
                )
                .bind(t.id)
                .fetch_one(&mut *db)
                .await
                .ok()
                .flatten();
                if linked.is_none() {
                    crate::transaction_ledger::post_entries(
                        &mut *db,
                        t.id,
                        "expense",
                        posting_account,
                        &posting_name,
                        source_account,
                        &source_name,
                        t.amount,
                        &t.description,
                    )
                    .await
                    .map_err(|e| {
                        error!("Failed to post ledger entries: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to pay installment" })),
                        )
                    })?;
                    sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
                        .bind(t.id)
                        .execute(&mut *db)
                        .await
                        .map_err(|e| {
                            error!("Failed to link ledger entries: {}", e);
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(json!({ "error": "Failed to pay installment" })),
                            )
                        })?;
                }
                (t, false)
            }
            None => {
                // Linked transaction was deleted, so create a new one.
                let description = format!(
                    "Parcela {}/{} — {}",
                    number, row.installments_total, row.plan_description
                );
                let t: Transaction = sqlx::query_as(
                    "INSERT INTO transactions
                        (description, amount, type, category_id, date, installment_plan_id, account_id)
                     VALUES ($1, $2, 'expense', $3, $4, $5, $6)
                     RETURNING id, description, amount, type, category_id, date, notes,
                               installment_plan_id, account_id, created_at, updated_at",
                )
                .bind(&description)
                .bind(row.installment_amount)
                .bind(row.category_id)
                .bind(row.due_date)
                .bind(id)
                .bind(source_account)
                .fetch_one(&mut *db)
                .await
                .map_err(|e| {
                    error!("Failed to create installment transaction: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to create installment transaction" })),
                    )
                })?;

                // Post the balanced ledger pair and link it to this transaction.
                crate::transaction_ledger::post_entries(
                    &mut *db,
                    t.id,
                    "expense",
                    posting_account,
                    &posting_name,
                    source_account,
                    &source_name,
                    t.amount,
                    &t.description,
                )
                .await
                .map_err(|e| {
                    error!("Failed to post ledger entries: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to create installment transaction" })),
                    )
                })?;
                sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
                    .bind(t.id)
                    .execute(&mut *db)
                    .await
                    .map_err(|e| {
                        error!("Failed to link ledger entries: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to create installment transaction" })),
                        )
                    })?;
                (t, true)
            }
        }
    } else {
        // No transaction yet, so create one and link it.
        let description = format!(
            "Parcela {}/{} — {}",
            number, row.installments_total, row.plan_description
        );
        let t: Transaction = sqlx::query_as(
            "INSERT INTO transactions
                (description, amount, type, category_id, date, installment_plan_id, account_id)
             VALUES ($1, $2, 'expense', $3, $4, $5, $6)
             RETURNING id, description, amount, type, category_id, date, notes,
                       installment_plan_id, account_id, created_at, updated_at",
        )
        .bind(&description)
        .bind(row.installment_amount)
        .bind(row.category_id)
        .bind(row.due_date)
        .bind(id)
        .bind(source_account)
        .fetch_one(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to create installment transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment transaction" })),
            )
        })?;

        // Post the balanced ledger pair and link it to this transaction.
        crate::transaction_ledger::post_entries(
            &mut *db,
            t.id,
            "expense",
            posting_account,
            &posting_name,
            source_account,
            &source_name,
            t.amount,
            &t.description,
        )
        .await
        .map_err(|e| {
            error!("Failed to post ledger entries: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment transaction" })),
            )
        })?;
        sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
            .bind(t.id)
            .execute(&mut *db)
            .await
            .map_err(|e| {
                error!("Failed to link ledger entries: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to create installment transaction" })),
                )
            })?;
        (t, true)
    };

    sqlx::query(
        "UPDATE installment_transactions
         SET status = 'paid', transaction_id = $1
         WHERE id = $2",
    )
    .bind(tx.id)
    .bind(row.row_id)
    .execute(&mut *db)
    .await
    .map_err(|e| {
        error!("Failed to mark installment as paid: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to mark installment as paid" })),
        )
    })?;

    db.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to pay installment" })),
        )
    })?;

    Ok(Json(PayInstallmentResponse {
        transaction: tx,
        created,
    }))
}
