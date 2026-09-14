//! Transaction CRUD endpoints.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use rust_decimal::Decimal;
use serde_json::json;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    CreateTransactionRequest, Transaction, TransactionListParams, TransactionListResponse,
    UpdateTransactionRequest,
};
use crate::routes::settings;
use crate::state::AppState;
use crate::transaction_ledger;
use sqlx::PgPool;

/// Returns a sub-router with all transaction routes mounted under `/api/transactions`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/transactions",
            get(list_transactions).post(create_transaction),
        )
        .route(
            "/api/transactions/{id}",
            get(get_transaction)
                .put(update_transaction)
                .delete(delete_transaction),
        )
}

/// Lists transactions, with optional filters (category, type, date range) and pagination.
#[utoipa::path(
    get,
    path = "/api/transactions",
    tag = "Transactions",
    params(
        ("page_size" = Option<u32>, Query, description = "Page size (default 50, max 200)"),
        ("page" = Option<u32>, Query, description = "Page offset (default 0)"),
        ("category_id" = Option<Uuid>, Query, description = "Filter by category UUID"),
        ("type" = Option<String>, Query, description = "Filter by 'income' or 'expense'"),
        ("start_date" = Option<String>, Query, description = "Filter by start date (inclusive)"),
        ("end_date" = Option<String>, Query, description = "Filter by end date (inclusive)"),
    ),
    responses(
        (status = 200, description = "Paginated list of transactions", body = TransactionListResponse),
        (status = 400, description = "Invalid filter parameters"),
    ),
)]
pub async fn list_transactions(
    State(state): State<AppState>,
    Query(params): Query<TransactionListParams>,
) -> Result<Json<TransactionListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let page_size = params.page_size.clamp(1, 200);
    let offset = params.page.saturating_mul(page_size);

    if let Some(t) = &params.r#type {
        if t != "income" && t != "expense" {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "type must be 'income' or 'expense'" })),
            ));
        }
    }

    if let (Some(start), Some(end)) = (&params.start_date, &params.end_date) {
        if start > end {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "start_date must be before or equal to end_date" })),
            ));
        }
    }

    // Use the nullable bind pattern `$1::uuid IS NULL OR category_id = $1`
    // allows a single static SQL query with optional filters.
    //
    // Date filters compare the *reporting* date
    // (`effective_transaction_date`), so the list matches the dashboard,
    // budgets and reports: with the `due_date` preference a card purchase made
    // shortly before the closing date is listed in the month its bill is due.
    // The extra `t.date` predicates are exact pre-filters (a reporting date is
    // never earlier than its transaction, nor more than a cycle later) that
    // keep the date index usable.
    let dating = settings::card_expense_dating(&state.pg_pool).await;
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM transactions t
         WHERE ($1::uuid IS NULL OR t.category_id = $1)
           AND ($2::text IS NULL OR t.type = $2)
           AND ($3::date IS NULL OR t.date >= $3 - INTERVAL '3 months')
           AND ($4::date IS NULL OR t.date <= $4)
           AND ($5::uuid IS NULL OR t.account_id = $5)
           AND ($3::date IS NULL OR effective_transaction_date(t.date, t.account_id, $6) >= $3)
           AND ($4::date IS NULL OR effective_transaction_date(t.date, t.account_id, $6) <= $4)",
    )
    .bind(params.category_id)
    .bind(&params.r#type)
    .bind(params.start_date)
    .bind(params.end_date)
    .bind(params.account_id)
    .bind(&dating)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to count transactions: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to count transactions" })),
        )
    })?;

    let items: Vec<Transaction> = sqlx::query_as(
        "SELECT t.id, t.description, t.amount, t.type, t.category_id, t.date, t.notes,
                t.installment_plan_id, t.account_id, t.created_at, t.updated_at,
                card_bill_due_date(t.account_id, t.date) AS card_due_date
         FROM transactions t
         WHERE ($1::uuid IS NULL OR t.category_id = $1)
           AND ($2::text IS NULL OR t.type = $2)
           AND ($3::date IS NULL OR t.date >= $3 - INTERVAL '3 months')
           AND ($4::date IS NULL OR t.date <= $4)
           AND ($5::uuid IS NULL OR t.account_id = $5)
           AND ($3::date IS NULL OR effective_transaction_date(t.date, t.account_id, $8) >= $3)
           AND ($4::date IS NULL OR effective_transaction_date(t.date, t.account_id, $8) <= $4)
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT $6 OFFSET $7",
    )
    .bind(params.category_id)
    .bind(&params.r#type)
    .bind(params.start_date)
    .bind(params.end_date)
    .bind(params.account_id)
    .bind(page_size as i64)
    .bind(offset as i64)
    .bind(&dating)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list transactions: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch transactions" })),
        )
    })?;

    Ok(Json(TransactionListResponse {
        items,
        total: total.0,
        page: params.page,
        page_size,
    }))
}

/// Resolves the payment and posting accounts and their display names for a
/// transaction payload. Runs before the write transaction is opened (it may
/// create and link a posting account for a new category).
#[allow(clippy::type_complexity)]
async fn resolve_ledger_accounts(
    pool: &PgPool,
    account_id: Option<Uuid>,
    category_id: Option<Uuid>,
    ttype: &str,
) -> Result<(Uuid, String, Uuid, String), (StatusCode, Json<serde_json::Value>)> {
    let source = transaction_ledger::resolve_source_account(pool, account_id)
        .await
        .map_err(|e| {
            error!("Failed to resolve source account: {e}");
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    let source_name = transaction_ledger::account_name(pool, source)
        .await
        .map_err(|e| {
            error!("Failed to load source account name: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to load source account" })),
            )
        })?;
    let posting = transaction_ledger::resolve_posting_account(pool, category_id, ttype)
        .await
        .map_err(|e| {
            error!("Failed to resolve posting account: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    let posting_name = transaction_ledger::account_name(pool, posting)
        .await
        .map_err(|e| {
            error!("Failed to load posting account name: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to load posting account" })),
            )
        })?;
    Ok((source, source_name, posting, posting_name))
}

/// Creates a new transaction.
#[utoipa::path(
    post,
    path = "/api/transactions",
    tag = "Transactions",
    request_body = CreateTransactionRequest,
    responses(
        (status = 201, description = "Transaction created", body = Transaction),
        (status = 400, description = "Invalid transaction payload"),
    ),
)]
pub async fn create_transaction(
    State(state): State<AppState>,
    Json(payload): Json<CreateTransactionRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    validate_transaction_payload(&payload.description, payload.amount, &payload.r#type)?;

    // Optional installment splitting from 2 to 60 monthly payments starting on `date`.
    let installment_spec = match payload.installments {
        Some(n) if !(2..=60).contains(&n) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "installments must be between 2 and 60" })),
            ));
        }
        Some(n) => {
            let count = n as i32;
            let per = (payload.amount / Decimal::from(count)).round_dp(2);
            let last = payload.amount - per * Decimal::from(count - 1);
            Some((count, per, last))
        }
        None => None,
    };
    // The returned (first) transaction carries the first installment amount.
    let first_amount = installment_spec
        .as_ref()
        .map(|(_, per, _)| *per)
        .unwrap_or(payload.amount);

    if let Some(cid) = payload.category_id {
        let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM categories WHERE id = $1")
            .bind(cid)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to validate category: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to validate category" })),
                )
            })?;

        if exists.is_none() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "category_id does not reference an existing category" })),
            ));
        }
    }

    // Resolve accounts before opening the DB transaction (read-only pool work).
    let (source_account, source_name, posting_account, posting_name) = resolve_ledger_accounts(
        &state.pg_pool,
        payload.account_id,
        payload.category_id,
        &payload.r#type,
    )
    .await?;

    let mut db = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    let transaction = sqlx::query_as::<_, Transaction>(
        "INSERT INTO transactions (description, amount, type, category_id, date, notes, installment_plan_id, account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, description, amount, type, category_id, date, notes,
                   installment_plan_id, account_id, created_at, updated_at",
    )
    .bind(payload.description.trim())
    .bind(first_amount)
    .bind(&payload.r#type)
    .bind(payload.category_id)
    .bind(payload.date)
    .bind(&payload.notes)
    .bind(payload.installment_plan_id)
    .bind(source_account)
    .fetch_one(&mut *db)
    .await
    .map_err(|e| {
        error!("Failed to create transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create transaction" })),
        )
    })?;

    // Post a balanced ledger pair (single source of truth for balances).
    transaction_ledger::post_entries(
        &mut *db,
        transaction.id,
        &transaction.r#type,
        posting_account,
        &posting_name,
        source_account,
        &source_name,
        transaction.amount,
        &transaction.description,
    )
    .await
    .map_err(|e| {
        error!("Failed to post ledger entries for {}: {e}", transaction.id);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to post ledger entries" })),
        )
    })?;

    // Link the transaction to its ledger group (same id).
    sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
        .bind(transaction.id)
        .execute(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to link ledger entries for {}: {e}", transaction.id);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to link ledger entries" })),
            )
        })?;

    // When splitting into installments, create the plan and materialize every
    // installment as a dated expense. On a cash basis each counts in its due month.
    if let Some((count, per, last)) = installment_spec {
        // The plan row (account_id is the resolved payment account).
        let plan_id: Uuid = sqlx::query_scalar(
            "INSERT INTO installment_plans
                (description, total_amount, installments, installment_amount, category_id, start_date, account_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id",
        )
        .bind(payload.description.trim())
        .bind(payload.amount)
        .bind(count)
        .bind(per)
        .bind(payload.category_id)
        .bind(payload.date)
        .bind(source_account)
        .fetch_one(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to create installment plan: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment plan" })),
            )
        })?;

        // First installment is the transaction we just created.
        sqlx::query("UPDATE transactions SET installment_plan_id = $1 WHERE id = $2")
            .bind(plan_id)
            .bind(transaction.id)
            .execute(&mut *db)
            .await
            .map_err(|e| {
                error!("Failed to link installment plan: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to create installment plan" })),
                )
            })?;
        sqlx::query(
            "INSERT INTO installment_transactions (plan_id, installment_number, due_date, transaction_id, status)
             VALUES ($1, 1, $2, $3, 'generated')",
        )
        .bind(plan_id)
        .bind(payload.date)
        .bind(transaction.id)
        .execute(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to schedule installment: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment plan" })),
            )
        })?;

        // Remaining installments are dated monthly, and each is a real expense.
        for i in 2..=count {
            let due = transaction_ledger::add_months(payload.date, i - 1);
            let amount_i = if i == count { last } else { per };
            let desc_i = format!("Parcela {}/{} — {}", i, count, payload.description.trim());
            let t: Transaction = sqlx::query_as(
                "INSERT INTO transactions (description, amount, type, category_id, date, notes, installment_plan_id, account_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id, description, amount, type, category_id, date, notes,
                           installment_plan_id, account_id, created_at, updated_at",
            )
            .bind(&desc_i)
            .bind(amount_i)
            .bind(&payload.r#type)
            .bind(payload.category_id)
            .bind(due)
            .bind(None::<String>)
            .bind(plan_id)
            .bind(source_account)
            .fetch_one(&mut *db)
            .await
            .map_err(|e| {
                error!("Failed to create installment transaction: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to create installment transaction" })),
                )
            })?;

            transaction_ledger::post_entries(
                &mut *db,
                t.id,
                &t.r#type,
                posting_account,
                &posting_name,
                source_account,
                &source_name,
                t.amount,
                &t.description,
            )
            .await
            .map_err(|e| {
                error!("Failed to post ledger entries for {}: {e}", t.id);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to post ledger entries" })),
                )
            })?;

            sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
                .bind(t.id)
                .execute(&mut *db)
                .await
                .map_err(|e| {
                    error!("Failed to link ledger entries for {}: {e}", t.id);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to post ledger entries" })),
                    )
                })?;

            sqlx::query(
                "INSERT INTO installment_transactions (plan_id, installment_number, due_date, transaction_id, status)
                 VALUES ($1, $2, $3, $4, 'generated')",
            )
            .bind(plan_id)
            .bind(i)
            .bind(due)
            .bind(t.id)
            .execute(&mut *db)
            .await
            .map_err(|e| {
                error!("Failed to schedule installment: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to create installment plan" })),
                )
            })?;
        }
    }

    // Reload the first transaction so the response reflects the linked plan.
    let transaction = if installment_spec.is_some() {
        sqlx::query_as::<_, Transaction>(
            "SELECT id, description, amount, type, category_id, date, notes,
                    installment_plan_id, account_id, created_at, updated_at
             FROM transactions WHERE id = $1",
        )
        .bind(transaction.id)
        .fetch_one(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to reload transaction {}: {e}", transaction.id);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to reload transaction" })),
            )
        })?
    } else {
        transaction
    };

    db.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit transaction" })),
        )
    })?;

    Ok((StatusCode::CREATED, Json(transaction)))
}

/// Returns a single transaction by ID.
#[utoipa::path(
    get,
    path = "/api/transactions/{id}",
    tag = "Transactions",
    params(
        ("id" = Uuid, Path, description = "Transaction UUID"),
    ),
    responses(
        (status = 200, description = "Transaction found", body = Transaction),
        (status = 404, description = "Transaction not found"),
    ),
)]
pub async fn get_transaction(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Transaction>, (StatusCode, Json<serde_json::Value>)> {
    let transaction = sqlx::query_as::<_, Transaction>(
        "SELECT id, description, amount, type, category_id, date, notes,
                installment_plan_id, account_id, created_at, updated_at
         FROM transactions WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch transaction {}: {}", id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch transaction" })),
        )
    })?;

    match transaction {
        Some(t) => Ok(Json(t)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Transaction not found" })),
        )),
    }
}

/// Updates an existing transaction.
#[utoipa::path(
    put,
    path = "/api/transactions/{id}",
    tag = "Transactions",
    params(
        ("id" = Uuid, Path, description = "Transaction UUID"),
    ),
    request_body = UpdateTransactionRequest,
    responses(
        (status = 200, description = "Transaction updated", body = Transaction),
        (status = 400, description = "Invalid transaction payload"),
        (status = 404, description = "Transaction not found"),
    ),
)]
pub async fn update_transaction(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateTransactionRequest>,
) -> Result<Json<Transaction>, (StatusCode, Json<serde_json::Value>)> {
    validate_transaction_payload(&payload.description, payload.amount, &payload.r#type)?;

    if let Some(cid) = payload.category_id {
        let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM categories WHERE id = $1")
            .bind(cid)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to validate category: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to validate category" })),
                )
            })?;

        if exists.is_none() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "category_id does not reference an existing category" })),
            ));
        }
    }

    // Resolve accounts before opening the DB transaction (read-only pool work).
    let (source_account, source_name, posting_account, posting_name) = resolve_ledger_accounts(
        &state.pg_pool,
        payload.account_id,
        payload.category_id,
        &payload.r#type,
    )
    .await?;

    // Capture the existing ledger group id so stale entries can be removed.
    let old_ledger_id: Option<Option<Uuid>> =
        sqlx::query_scalar("SELECT ledger_transaction_id FROM transactions WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to fetch transaction {}: {}", id, e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to update transaction" })),
                )
            })?;

    let old_ledger_id = match old_ledger_id {
        Some(v) => v,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Transaction not found" })),
            ))
        }
    };

    let mut db = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    let transaction = sqlx::query_as::<_, Transaction>(
        "UPDATE transactions
         SET description = $1, amount = $2, type = $3, category_id = $4,
             date = $5, notes = $6, installment_plan_id = $7, account_id = $8, updated_at = NOW()
         WHERE id = $9
         RETURNING id, description, amount, type, category_id, date, notes,
                   installment_plan_id, account_id, created_at, updated_at",
    )
    .bind(payload.description.trim())
    .bind(payload.amount)
    .bind(&payload.r#type)
    .bind(payload.category_id)
    .bind(payload.date)
    .bind(&payload.notes)
    .bind(payload.installment_plan_id)
    .bind(source_account)
    .bind(id)
    .fetch_optional(&mut *db)
    .await
    .map_err(|e| {
        error!("Failed to update transaction {}: {}", id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update transaction" })),
        )
    })?;

    let transaction = match transaction {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Transaction not found" })),
            ))
        }
    };

    // Replace the ledger entries with the new posting.
    transaction_ledger::delete_entries(&mut *db, id, old_ledger_id).await;
    transaction_ledger::post_entries(
        &mut *db,
        transaction.id,
        &transaction.r#type,
        posting_account,
        &posting_name,
        source_account,
        &source_name,
        transaction.amount,
        &transaction.description,
    )
    .await
    .map_err(|e| {
        error!("Failed to post ledger entries for {}: {e}", transaction.id);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to post ledger entries" })),
        )
    })?;

    sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
        .bind(transaction.id)
        .execute(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to link ledger entries for {}: {e}", transaction.id);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to link ledger entries" })),
            )
        })?;

    db.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit transaction" })),
        )
    })?;

    Ok(Json(transaction))
}

/// Deletes a transaction by ID.
#[utoipa::path(
    delete,
    path = "/api/transactions/{id}",
    tag = "Transactions",
    params(
        ("id" = Uuid, Path, description = "Transaction UUID"),
    ),
    responses(
        (status = 204, description = "Transaction deleted"),
        (status = 404, description = "Transaction not found"),
    ),
)]
pub async fn delete_transaction(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    // Capture the existing ledger group id so its entries can be removed.
    let old_ledger_id: Option<Option<Uuid>> =
        sqlx::query_scalar("SELECT ledger_transaction_id FROM transactions WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to fetch transaction {}: {}", id, e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to delete transaction" })),
                )
            })?;

    let old_ledger_id = match old_ledger_id {
        Some(v) => v,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Transaction not found" })),
            ))
        }
    };

    let mut db = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    // Remove the transaction's ledger entries first (they are the audit trail).
    transaction_ledger::delete_entries(&mut *db, id, old_ledger_id).await;

    // Also drop any installment-plan scheduling rows referencing this
    // transaction. Otherwise the FK below blocks the DELETE (500).
    sqlx::query("DELETE FROM installment_transactions WHERE transaction_id = $1")
        .bind(id)
        .execute(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to unlink installment schedule for {}: {}", id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete transaction" })),
            )
        })?;

    let result = sqlx::query("DELETE FROM transactions WHERE id = $1")
        .bind(id)
        .execute(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to delete transaction {}: {}", id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete transaction" })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Transaction not found" })),
        ));
    }

    db.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit transaction" })),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Shared validation for transaction create/update payloads.
fn validate_transaction_payload(
    description: &str,
    amount: Decimal,
    ttype: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if description.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "description must not be empty" })),
        ));
    }
    if amount <= Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "amount must be greater than zero" })),
        ));
    }
    if ttype != "income" && ttype != "expense" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "type must be 'income' or 'expense'" })),
        ));
    }
    Ok(())
}
