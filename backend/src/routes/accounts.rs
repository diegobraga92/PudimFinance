//! Chart-of-accounts endpoints.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::NaiveDate;
use serde_json::json;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    account_type_for_kind, is_valid_account_kind, is_valid_account_type, Account,
    AccountAdjustmentRequest, AccountWithBalance, CreateAccountRequest, UpdateAccountRequest,
};
use crate::state::AppState;
use rust_decimal::Decimal;
use sqlx::PgPool;

/// Routes for chart-of-accounts operations.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/accounts", get(list_accounts).post(create_account))
        .route(
            "/api/accounts/{id}",
            get(get_account).put(update_account).delete(delete_account),
        )
        .route("/api/accounts/{id}/adjust", post(adjust_account))
}

/// Lists accounts with computed balances.
#[utoipa::path(
    get,
    path = "/api/accounts",
    tag = "Accounts",
    responses(
        (status = 200, description = "List of accounts with balances", body = [AccountWithBalance]),
    ),
)]
pub async fn list_accounts(
    State(state): State<AppState>,
) -> Result<Json<Vec<AccountWithBalance>>, (StatusCode, Json<serde_json::Value>)> {
    let accounts = sqlx::query_as::<_, AccountWithBalance>(
        "SELECT a.id, a.name, a.type, a.account_kind, a.icon, a.parent_id, a.closing_day, a.due_day,
                a.credit_limit, a.created_at,
                COALESCE(SUM(e.debit_amount) - SUM(e.credit_amount), 0) AS balance,
                COUNT(e.id) AS transaction_count
         FROM accounts a
         LEFT JOIN ledger_entries e ON e.account_id = a.id
         GROUP BY a.id
         ORDER BY
           CASE a.type
             WHEN 'asset' THEN 0
             WHEN 'liability' THEN 1
             WHEN 'equity' THEN 2
             WHEN 'income' THEN 3
             ELSE 4
           END,
           a.name",
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list accounts: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list accounts" })),
        )
    })?;

    Ok(Json(accounts))
}

/// Fetches an account with its computed balance.
#[utoipa::path(
    get,
    path = "/api/accounts/{id}",
    tag = "Accounts",
    params(
        ("id" = Uuid, Path, description = "Account UUID"),
    ),
    responses(
        (status = 200, description = "Account found", body = AccountWithBalance),
        (status = 404, description = "Account not found"),
    ),
)]
pub async fn get_account(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<AccountWithBalance>, (StatusCode, Json<serde_json::Value>)> {
    let account = sqlx::query_as::<_, AccountWithBalance>(
        "SELECT a.id, a.name, a.type, a.account_kind, a.icon, a.parent_id, a.closing_day, a.due_day,
                a.credit_limit, a.created_at,
                COALESCE(SUM(e.debit_amount) - SUM(e.credit_amount), 0) AS balance,
                COUNT(e.id) AS transaction_count
         FROM accounts a
         LEFT JOIN ledger_entries e ON e.account_id = a.id
         WHERE a.id = $1
         GROUP BY a.id",
    )
    .bind(id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch account: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch account" })),
        )
    })?;

    match account {
        Some(acc) => Ok(Json(acc)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Account not found" })),
        )),
    }
}

/// Validates a parent account id, returning a 400 error string on failure.
async fn validate_parent(
    state: &AppState,
    parent_id: Option<Uuid>,
    self_id: Option<Uuid>,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if let Some(pid) = parent_id {
        if self_id == Some(pid) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "parent_id cannot reference the account itself" })),
            ));
        }
        let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM accounts WHERE id = $1")
            .bind(pid)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to validate parent account: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to validate parent account" })),
                )
            })?;

        if exists.is_none() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "parent_id does not reference an existing account" })),
            ));
        }
    }
    Ok(())
}

/// Validates credit-card fields for liability accounts.
fn validate_card_fields(
    ttype: &str,
    closing_day: Option<i16>,
    due_day: Option<i16>,
    credit_limit: Option<Decimal>,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    for (label, day) in [("closing_day", closing_day), ("due_day", due_day)] {
        if let Some(d) = day {
            if !(1..=31).contains(&d) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("{label} must be between 1 and 31") })),
                ));
            }
        }
    }
    if let Some(l) = credit_limit {
        if l < Decimal::ZERO {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "credit_limit must be greater than or equal to zero" })),
            ));
        }
    }
    if ttype != "liability"
        && (closing_day.is_some() || due_day.is_some() || credit_limit.is_some())
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "closing_day, due_day, and credit_limit are only valid for liability (credit card) accounts"
            })),
        ));
    }
    Ok(())
}

/// Resolves and validates an account kind and accounting type.
fn resolve_kind_and_type(
    kind: Option<&str>,
    ttype: &str,
) -> Result<(String, String), (StatusCode, Json<serde_json::Value>)> {
    let kind = kind.unwrap_or("other").to_string();
    if !is_valid_account_kind(&kind) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "account_kind must be one of: bank, cash, card, loan, investment, income, expense, equity, other"
            })),
        ));
    }
    let ttype = account_type_for_kind(&kind)
        .map(String::from)
        .unwrap_or_else(|| ttype.to_string());
    if !is_valid_account_type(&ttype) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "type must be one of: asset, liability, equity, income, expense"
            })),
        ));
    }
    Ok((kind, ttype))
}

/// Creates an account.
#[utoipa::path(
    post,
    path = "/api/accounts",
    tag = "Accounts",
    request_body = CreateAccountRequest,
    responses(
        (status = 201, description = "Account created", body = Account),
        (status = 400, description = "Invalid account payload"),
    ),
)]
pub async fn create_account(
    State(state): State<AppState>,
    Json(payload): Json<CreateAccountRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name must not be empty" })),
        ));
    }

    let (kind, ttype) = resolve_kind_and_type(payload.account_kind.as_deref(), &payload.r#type)?;

    if kind == "card" && (payload.closing_day.is_none() || payload.due_day.is_none()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(
                json!({ "error": "closing_day and due_day are required for credit card accounts" }),
            ),
        ));
    }

    validate_card_fields(
        &ttype,
        payload.closing_day,
        payload.due_day,
        payload.credit_limit,
    )?;

    validate_parent(&state, payload.parent_id, None).await?;

    let mut db = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin account creation: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create account" })),
        )
    })?;

    let account = sqlx::query_as::<_, Account>(
        "INSERT INTO accounts (name, type, account_kind, icon, parent_id, closing_day, due_day, credit_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, type, account_kind, icon, parent_id, closing_day, due_day, credit_limit, created_at",
    )
    .bind(name)
    .bind(&ttype)
    .bind(&kind)
    .bind(&payload.icon)
    .bind(payload.parent_id)
    .bind(payload.closing_day)
    .bind(payload.due_day)
    .bind(payload.credit_limit)
    .fetch_one(&mut *db)
    .await
    .map_err(|e| {
        error!("Failed to create account: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create account" })),
        )
    })?;

    if let Some(initial_balance) = payload.initial_balance {
        if initial_balance < Decimal::ZERO {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "initial_balance must be greater than or equal to zero" })),
            ));
        }
        if initial_balance > Decimal::ZERO {
            let ledger_delta = if ttype == "liability" {
                -initial_balance
            } else {
                initial_balance
            };
            post_balance_adjustment_in_tx(
                &mut db,
                account.id,
                ledger_delta,
                "Opening balance",
                None,
            )
            .await?;
        }
    }

    db.commit().await.map_err(|e| {
        error!("Failed to commit account creation: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create account" })),
        )
    })?;

    Ok((StatusCode::CREATED, Json(account)))
}

/// Updates an account.
#[utoipa::path(
    put,
    path = "/api/accounts/{id}",
    tag = "Accounts",
    params(
        ("id" = Uuid, Path, description = "Account UUID"),
    ),
    request_body = UpdateAccountRequest,
    responses(
        (status = 200, description = "Account updated", body = Account),
        (status = 400, description = "Invalid account payload"),
        (status = 404, description = "Account not found"),
    ),
)]
pub async fn update_account(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateAccountRequest>,
) -> Result<Json<Account>, (StatusCode, Json<serde_json::Value>)> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name must not be empty" })),
        ));
    }

    let (kind, ttype) = resolve_kind_and_type(payload.account_kind.as_deref(), &payload.r#type)?;

    if kind == "card" && (payload.closing_day.is_none() || payload.due_day.is_none()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(
                json!({ "error": "closing_day and due_day are required for credit card accounts" }),
            ),
        ));
    }

    validate_card_fields(
        &ttype,
        payload.closing_day,
        payload.due_day,
        payload.credit_limit,
    )?;

    validate_parent(&state, payload.parent_id, Some(id)).await?;

    let result = sqlx::query_as::<_, Account>(
        "UPDATE accounts
         SET name = $1, type = $2, account_kind = $3, icon = $4, parent_id = $5, closing_day = $6,
             due_day = $7, credit_limit = $8
         WHERE id = $9
         RETURNING id, name, type, account_kind, icon, parent_id, closing_day, due_day, credit_limit, created_at",
    )
    .bind(name)
    .bind(&ttype)
    .bind(&kind)
    .bind(&payload.icon)
    .bind(payload.parent_id)
    .bind(payload.closing_day)
    .bind(payload.due_day)
    .bind(payload.credit_limit)
    .bind(id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to update account: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update account" })),
        )
    })?;

    match result {
        Some(acc) => Ok(Json(acc)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Account not found" })),
        )),
    }
}

/// Adjusts an account to a target balance through a balanced equity posting.
#[utoipa::path(
    post,
    path = "/api/accounts/{id}/adjust",
    tag = "Accounts",
    params(("id" = Uuid, Path, description = "Account UUID")),
    request_body = AccountAdjustmentRequest,
    responses((status = 201, description = "Account adjustment recorded")),
)]
pub async fn adjust_account(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<AccountAdjustmentRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if payload.target_balance < Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "target_balance must be greater than or equal to zero" })),
        ));
    }
    let description = payload
        .description
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Balance adjustment");
    let current: Option<(String, Decimal)> = sqlx::query_as(
        "SELECT a.type, COALESCE(SUM(e.debit_amount) - SUM(e.credit_amount), 0)
         FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
         WHERE a.id = $1 GROUP BY a.id, a.type",
    )
    .bind(id)
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|e| internal_error("Failed to load account", e))?;
    let Some((account_type, raw_balance)) = current else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Account not found" })),
        ));
    };
    let current_display = if account_type == "liability" {
        -raw_balance
    } else {
        raw_balance
    };
    let delta = payload.target_balance - current_display;
    if delta == Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Account already has this balance" })),
        ));
    }
    let ledger_delta = if account_type == "liability" {
        -delta
    } else {
        delta
    };
    post_balance_adjustment(&state, id, ledger_delta, description, Some(payload.date)).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "account_id": id, "target_balance": payload.target_balance })),
    ))
}

fn internal_error(message: &str, error: sqlx::Error) -> (StatusCode, Json<serde_json::Value>) {
    error!("{}: {}", message, error);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": message })),
    )
}

async fn post_balance_adjustment(
    state: &AppState,
    account_id: Uuid,
    delta: Decimal,
    description: &str,
    date: Option<NaiveDate>,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let mut tx = state
        .pg_pool
        .begin()
        .await
        .map_err(|e| internal_error("Failed to begin adjustment", e))?;
    post_balance_adjustment_in_tx(&mut tx, account_id, delta, description, date).await?;
    tx.commit()
        .await
        .map_err(|e| internal_error("Failed to commit adjustment", e))?;
    Ok(())
}

async fn post_balance_adjustment_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: Uuid,
    delta: Decimal,
    description: &str,
    date: Option<NaiveDate>,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let equity_id: Uuid = if let Some(existing) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM accounts WHERE type = 'equity' AND name = 'Balance adjustments' LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| internal_error("Failed to find adjustment account", e))?
    {
        existing
    } else {
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO accounts (name, type, account_kind, icon)
             VALUES ('Balance adjustments', 'equity', 'equity', 'scale')
             ON CONFLICT DO NOTHING
             RETURNING id",
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| internal_error("Failed to create adjustment account", e))?;
        if let Some(inserted) = inserted {
            inserted
        } else {
            sqlx::query_scalar(
                "SELECT id FROM accounts WHERE type = 'equity' AND name = 'Balance adjustments' LIMIT 1",
            )
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| internal_error("Failed to load adjustment account", e))?
        }
    };
    let tx_id = Uuid::new_v4();
    let amount = delta.abs();
    let account_debit = delta > Decimal::ZERO;
    sqlx::query(
        "INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
         VALUES ($1, $2, $3, $4, $5), ($1, $6, $7, $8, $5)",
    )
    .bind(tx_id).bind(account_id)
    .bind(if account_debit { amount } else { Decimal::ZERO })
    .bind(if account_debit { Decimal::ZERO } else { amount })
    .bind(description)
    .bind(equity_id)
    .bind(if account_debit { Decimal::ZERO } else { amount })
    .bind(if account_debit { amount } else { Decimal::ZERO })
    .execute(&mut **tx)
    .await
    .map_err(|e| internal_error("Failed to record adjustment", e))?;
    sqlx::query(
        "INSERT INTO events (aggregate_id, aggregate_type, event_type, payload)
         VALUES ($1, 'Transaction', 'TransactionRecorded', jsonb_build_object('transaction_id', $1, 'description', $2, 'date', $3))",
    ).bind(tx_id).bind(description).bind(date.unwrap_or_else(|| chrono::Utc::now().date_naive()))
    .execute(&mut **tx)
    .await
    .map_err(|e| internal_error("Failed to store adjustment event", e))?;
    Ok(())
}

/// Rejects deleting an account that still has ledger entries or sub-accounts.
///
/// Shared by the REST route and the offline sync push so both paths enforce the
/// same rule. Returns the HTTP status and user-facing message for the caller.
pub(crate) async fn ensure_account_deletable(
    pool: &PgPool,
    id: Uuid,
) -> Result<(), (StatusCode, String)> {
    let entry_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM ledger_entries WHERE account_id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| {
                error!("Failed to check ledger references: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to check account usage".to_string(),
                )
            })?;

    if entry_count.0 > 0 {
        return Err((
            StatusCode::CONFLICT,
            format!(
                "Account is used by {} ledger entr{}. Reassign or delete them first.",
                entry_count.0,
                if entry_count.0 == 1 { "y" } else { "ies" }
            ),
        ));
    }

    let child_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM accounts WHERE parent_id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            error!("Failed to check sub-account references: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to check account usage".to_string(),
            )
        })?;

    if child_count.0 > 0 {
        return Err((
            StatusCode::CONFLICT,
            format!(
                "Account has {} sub-account{} that depend on it. Remove them first.",
                child_count.0,
                if child_count.0 == 1 { "" } else { "s" }
            ),
        ));
    }

    Ok(())
}

/// Deletes an account.
#[utoipa::path(
    delete,
    path = "/api/accounts/{id}",
    tag = "Accounts",
    params(
        ("id" = Uuid, Path, description = "Account UUID"),
    ),
    responses(
        (status = 204, description = "Account deleted"),
        (status = 404, description = "Account not found"),
        (status = 409, description = "Account is in use"),
    ),
)]
pub async fn delete_account(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    ensure_account_deletable(&state.pg_pool, id)
        .await
        .map_err(|(status, message)| (status, Json(json!({ "error": message }))))?;

    let result = sqlx::query("DELETE FROM accounts WHERE id = $1")
        .bind(id)
        .execute(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to delete account: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete account" })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Account not found" })),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}
