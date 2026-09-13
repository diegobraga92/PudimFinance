//! Ledger HTTP routes.
//!
//! Exposes double-entry transaction creation, the single-to-double migration
//! endpoint, and the reconciliation (CSV matching) endpoint.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::events::EventPublisher;
use crate::ledger::{validate_balance, AccountMap};
use crate::metrics;
use crate::models::{
    CreateLedgerTransactionRequest, CreateLedgerTransactionResponse, LedgerEntry,
    LedgerTransaction, MigrationResponse, ReconciliationItem, ReconciliationUploadRequest,
    ReconciliationUploadResponse, StatementLine,
};
use crate::state::AppState;

/// Returns a sub-router with all ledger routes mounted under `/api/ledger`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/ledger/transactions",
            axum::routing::post(create_ledger_transaction),
        )
        .route("/api/ledger/transactions", get(list_ledger_transactions))
        .route(
            "/api/migrate/single-to-double",
            axum::routing::post(migrate_single_to_double),
        )
        .route("/api/reconciliation", axum::routing::post(reconcile))
        .route(
            "/api/reconciliation/upload",
            axum::routing::post(upload_reconciliation),
        )
        .route(
            "/api/reconciliation/history",
            axum::routing::get(reconciliation_history),
        )
}

/// Lists ledger transactions (grouped by transaction_id) with their entries.
#[utoipa::path(
    get,
    path = "/api/ledger/transactions",
    tag = "Ledger",
    responses(
        (status = 200, description = "List of ledger transactions"),
    ),
)]
pub async fn list_ledger_transactions(
    State(state): State<AppState>,
) -> Result<Json<Vec<LedgerTransaction>>, (StatusCode, Json<serde_json::Value>)> {
    let entries = fetch_entries(&state.pg_pool).await;
    let entries = match entries {
        Ok(e) => e,
        Err(_) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to fetch ledger transactions" })),
            ))
        }
    };

    let mut transactions: std::collections::BTreeMap<
        Uuid,
        (String, NaiveDate, chrono::DateTime<Utc>, Vec<LedgerEntry>),
    > = std::collections::BTreeMap::new();

    for entry in entries {
        let txid = entry.transaction_id;
        transactions
            .entry(txid)
            .and_modify(|(_, _, _, vec)| vec.push(entry.clone()))
            .or_insert_with(|| {
                (
                    entry.description.clone().unwrap_or_default(),
                    // placeholder, filled later from the entry dates
                    NaiveDate::from_ymd_opt(1970, 1, 1).unwrap(),
                    entry.recorded_at,
                    vec![entry],
                )
            });
    }

    // Fetch transaction metadata from a simple transactions table if available
    // (the ledger_entries table has no date, so we derive it from the recorded_at
    // and the associated simple transaction when applicable).
    let simple_rows: Vec<(Uuid, String, NaiveDate)> = sqlx::query_as(
        "SELECT id, description, date FROM transactions WHERE ledger_transaction_id IS NOT NULL",
    )
    .fetch_all(&state.pg_pool)
    .await
    .unwrap_or_default();

    let mut by_simple_tx: std::collections::HashMap<Uuid, (String, NaiveDate)> = simple_rows
        .into_iter()
        .map(|(id, desc, date)| (id, (desc, date)))
        .collect();

    let mut result = Vec::with_capacity(transactions.len());
    for (txid, (desc, _date, recorded_at, entries)) in transactions {
        // Try to resolve description/date from simple transaction mapping
        let resolved = by_simple_tx.remove(&txid);
        let final_desc = resolved.as_ref().map(|(d, _)| d.clone()).unwrap_or(desc);
        let final_date = resolved.map(|(_, d)| d).unwrap_or_else(|| {
            // Derive date from earliest entry recorded_at
            entries
                .iter()
                .map(|e| e.recorded_at.date_naive())
                .min()
                .unwrap_or_else(|| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap())
        });

        result.push(LedgerTransaction {
            transaction_id: txid,
            description: final_desc,
            date: final_date,
            entries,
            recorded_at,
        });
    }

    Ok(Json(result))
}

/// Creates a new double-entry ledger transaction.
#[utoipa::path(
    post,
    path = "/api/ledger/transactions",
    tag = "Ledger",
    request_body = CreateLedgerTransactionRequest,
    responses(
        (status = 201, description = "Ledger transaction created", body = CreateLedgerTransactionResponse),
        (status = 400, description = "Invalid ledger transaction payload"),
        (status = 409, description = "Idempotency key already used"),
    ),
)]
pub async fn create_ledger_transaction(
    State(state): State<AppState>,
    Json(payload): Json<CreateLedgerTransactionRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    if payload.description.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "description must not be empty" })),
        ));
    }
    if payload.entries.len() < 2 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "At least two ledger entries are required" })),
        ));
    }

    let debits: Vec<Decimal> = payload.entries.iter().map(|e| e.debit_amount).collect();
    let credits: Vec<Decimal> = payload.entries.iter().map(|e| e.credit_amount).collect();

    if let Err(e) = validate_balance(&debits, &credits) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ));
    }

    for e in &payload.entries {
        let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM accounts WHERE id = $1")
            .bind(e.account_id)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|err| {
                error!("Failed to check account: {}", err);
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

    // If an idempotency key was provided and already processed, return the cached response
    let idempotency_key = payload.idempotency_key.clone();
    if let Some(key) = &idempotency_key {
        let cached: Option<(i32, serde_json::Value)> = sqlx::query_as(
            "SELECT response_status, response_body::jsonb FROM idempotency_keys WHERE key = $1",
        )
        .bind(key)
        .fetch_optional(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to check idempotency key: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to check idempotency" })),
            )
        })?;

        if let Some((status, body)) = cached {
            return Ok((StatusCode::from_u16(status as u16).unwrap(), Json(body)));
        }
    }

    let transaction_id = Uuid::new_v4();
    let recorded_at = Utc::now();

    // Insert ledger entries and event inside a DB transaction
    let mut tx = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    let mut saved_entries = Vec::with_capacity(payload.entries.len());

    for entry in &payload.entries {
        let saved: crate::models::LedgerEntry = sqlx::query_as(
            "INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, transaction_id, account_id, NULL AS account_name, debit_amount, credit_amount, description, recorded_at",
        )
        .bind(transaction_id)
        .bind(entry.account_id)
        .bind(entry.debit_amount)
        .bind(entry.credit_amount)
        .bind(&entry.description)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            error!("Failed to insert ledger entry: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save ledger entry" })),
            )
        })?;

        saved_entries.push(saved);
    }

    // Insert TransactionRecorded event
    let event_payload = json!({
        "transaction_id": transaction_id.to_string(),
        "description": payload.description,
        "date": payload.date.to_string(),
        "recorded_at": recorded_at.to_rfc3339(),
        "entries": payload.entries.iter().map(|e| {
            json!({
                "account_id": e.account_id.to_string(),
                "debit_amount": e.debit_amount.to_string(),
                "credit_amount": e.credit_amount.to_string(),
            })
        }).collect::<Vec<_>>(),
    });

    sqlx::query(
        "INSERT INTO events (aggregate_id, aggregate_type, event_type, payload)
         VALUES ($1, 'Transaction', 'TransactionRecorded', $2)",
    )
    .bind(transaction_id)
    .bind(event_payload.clone())
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        error!("Failed to insert event: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to store event" })),
        )
    })?;

    // Store idempotency key if provided (before commit so replay works)
    if let Some(key) = &idempotency_key {
        sqlx::query(
            "INSERT INTO idempotency_keys (key, response_status, response_body)
             VALUES ($1, 201, $2)",
        )
        .bind(key)
        .bind(event_payload.clone())
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            error!("Failed to store idempotency key: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to store idempotency key" })),
            )
        })?;
    }

    tx.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit transaction" })),
        )
    })?;

    metrics::inc_ledger_transactions();

    // Publish the event to RabbitMQ. Failures are logged, not returned.
    let publisher = state.event_publisher.clone();
    let tx_id_clone = transaction_id;
    let desc_clone = payload.description.clone();
    let date_clone = payload.date;
    let saved_entries_clone = saved_entries.clone();
    tokio::spawn(async move {
        let event = EventPublisher::make_transaction_recorded_event(
            &tx_id_clone,
            &desc_clone,
            &date_clone,
            &saved_entries_clone,
        );
        if let Err(e) = publisher.publish_transaction_recorded(&event).await {
            warn!("Failed to publish event for tx {}: {}", tx_id_clone, e);
        }
    });

    let transaction = LedgerTransaction {
        transaction_id,
        description: payload.description,
        date: payload.date,
        entries: saved_entries,
        recorded_at,
    };

    let response = CreateLedgerTransactionResponse {
        transaction,
        status: 201,
    };

    Ok((
        StatusCode::CREATED,
        Json(
            serde_json::to_value(response)
                .unwrap_or_else(|_| json!({ "error": "Serialization error" })),
        ),
    ))
}

/// Migrates all simple transactions to double-entry ledger pairs.
#[utoipa::path(
    post,
    path = "/api/migrate/single-to-double",
    tag = "Ledger",
    responses(
        (status = 200, description = "Migration completed", body = MigrationResponse),
    ),
)]
pub async fn migrate_single_to_double(
    State(state): State<AppState>,
) -> Result<Json<MigrationResponse>, (StatusCode, Json<serde_json::Value>)> {
    info!("Starting single-to-double migration");

    let simple_rows: Vec<(
        Uuid,
        String,
        rust_decimal::Decimal,
        String,
        Option<Uuid>,
        NaiveDate,
    )> = sqlx::query_as(
        "SELECT id, description, amount, type, category_id, date
         FROM transactions
         WHERE ledger_transaction_id IS NULL",
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch simple transactions for migration: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch transactions for migration" })),
        )
    })?;

    let account_map = AccountMap::load(&state.pg_pool).await.map_err(|e| {
        error!("Failed to load account map: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to load chart of accounts" })),
        )
    })?;

    let cash = account_map.cash_account().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Cash account not found in chart of accounts" })),
        )
    })?;

    let total_processed = simple_rows.len() as i64;
    let mut migrated: i64 = 0;
    let already_migrated: i64 = 0;
    let mut failed: i64 = 0;

    for (id, description, amount, ttype, category_id, _date) in &simple_rows {
        // Resolve the paired account. Income credits the income account and
        // debits Cash. Expense debits the expense account and credits Cash. We
        // try a category match first and fall back to generic accounts.
        let paired_name = if ttype == "income" {
            match category_id {
                Some(cid) => {
                    let cat_name: Option<String> =
                        sqlx::query_scalar("SELECT name FROM categories WHERE id = $1")
                            .bind(cid)
                            .fetch_optional(&state.pg_pool)
                            .await
                            .unwrap_or(None);
                    cat_name
                        .map(|n| match n.as_str() {
                            "Salary" => "Salary Income".to_string(),
                            "Freelance" => "Freelance Income".to_string(),
                            "Investments" => "Investment Income".to_string(),
                            "Gifts Received" => "Gifts Received".to_string(),
                            "Other Income" => "Other Income".to_string(),
                            _ => n,
                        })
                        .unwrap_or_else(|| "Other Income".to_string())
                }
                None => "Other Income".to_string(),
            }
        } else {
            match category_id {
                Some(cid) => {
                    let cat_name: Option<String> =
                        sqlx::query_scalar("SELECT name FROM categories WHERE id = $1")
                            .bind(cid)
                            .fetch_optional(&state.pg_pool)
                            .await
                            .unwrap_or(None);
                    cat_name.unwrap_or_else(|| "Miscellaneous".to_string())
                }
                None => "Miscellaneous".to_string(),
            }
        };

        let paired = account_map.get(&paired_name);

        match paired {
            Some((paired_id, _)) => {
                let cash_id = cash.0;
                let mut tx = state.pg_pool.begin().await.map_err(|e| {
                    error!("Migration: failed to begin tx: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to begin migration transaction" })),
                    )
                })?;

                let tx_ledger_uuid = Uuid::new_v4();

                let success = if ttype == "income" {
                    // Debit Cash, credit income
                    sqlx::query(
                        "INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
                         VALUES ($1, $2, $3, $4, $5),
                                ($1, $6, $7, $8, $9)",
                    )
                    .bind(tx_ledger_uuid)
                    .bind(cash_id)
                    .bind(amount)
                    .bind(Decimal::ZERO)
                    .bind(format!("{} (income)", description))
                    .bind(paired_id)
                    .bind(Decimal::ZERO)
                    .bind(amount)
                    .bind(format!("{} (income)", description))
                    .execute(&mut *tx)
                    .await
                    .is_ok()
                } else {
                    // Debit expense, credit Cash
                    sqlx::query(
                        "INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
                         VALUES ($1, $2, $3, $4, $5),
                                ($1, $6, $7, $8, $9)",
                    )
                    .bind(tx_ledger_uuid)
                    .bind(paired_id)
                    .bind(amount)
                    .bind(Decimal::ZERO)
                    .bind(format!("{} (expense)", description))
                    .bind(cash_id)
                    .bind(Decimal::ZERO)
                    .bind(amount)
                    .bind(format!("{} (expense)", description))
                    .execute(&mut *tx)
                    .await
                    .is_ok()
                };

                // Mark the simple transaction as migrated using the same ledger UUID
                let mark =
                    sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $2")
                        .bind(tx_ledger_uuid)
                        .bind(id)
                        .execute(&mut *tx)
                        .await
                        .is_ok();

                if success && mark {
                    if tx.commit().await.is_ok() {
                        migrated += 1;
                    } else {
                        failed += 1;
                    }
                } else {
                    tx.rollback().await.ok();
                    failed += 1;
                }
            }
            None => {
                warn!(
                    "Migration: no account found for category '{}', skipping tx {}",
                    paired_name, id
                );
                failed += 1;
            }
        }
    }

    Ok(Json(MigrationResponse {
        total_processed,
        migrated,
        already_migrated,
        failed,
    }))
}

/// Reconciles uploaded statement lines against existing transactions.
#[utoipa::path(
    post,
    path = "/api/reconciliation",
    tag = "Ledger",
    request_body = ReconciliationUploadRequest,
    responses(
        (status = 200, description = "Reconciliation completed", body = ReconciliationUploadResponse),
        (status = 400, description = "Invalid upload"),
    ),
)]
pub async fn reconcile(
    State(state): State<AppState>,
    Json(payload): Json<ReconciliationUploadRequest>,
) -> Result<Json<ReconciliationUploadResponse>, (StatusCode, Json<serde_json::Value>)> {
    if payload.lines.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "statement lines must not be empty" })),
        ));
    }

    let auto_create = payload.auto_create_unmatched.unwrap_or(false);
    run_reconciliation(&state, &payload.statement_name, &payload.lines, auto_create).await
}

/// Shared reconciliation engine. Creates the summary record, matches each line
/// against existing transactions (optionally auto-creating for unmatched rows),
/// and persists per-row results.
async fn run_reconciliation(
    state: &AppState,
    statement_name: &str,
    lines: &[StatementLine],
    auto_create: bool,
) -> Result<Json<ReconciliationUploadResponse>, (StatusCode, Json<serde_json::Value>)> {
    let total_rows = lines.len() as i32;

    let recon_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO reconciliations (id, statement_name, total_rows, status)
         VALUES ($1, $2, $3, 'completed')",
    )
    .bind(recon_id)
    .bind(statement_name)
    .bind(total_rows)
    .execute(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to create reconciliation: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to start reconciliation" })),
        )
    })?;

    let mut matched_rows: i64 = 0;
    let mut unmatched_rows: i64 = 0;
    let mut items = Vec::with_capacity(lines.len());

    for line in lines {
        // Match against simple transactions by exact amount (ignoring sign)
        // within a ±1 day date tolerance
        let signed_amount = line.amount;
        let abs_amount = signed_amount.abs();

        let match_result: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM transactions
             WHERE ABS(amount - $1) < 0.01
               AND date BETWEEN $2 - INTERVAL '1 day' AND $2 + INTERVAL '1 day'
             LIMIT 1",
        )
        .bind(abs_amount)
        .bind(line.date)
        .fetch_optional(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to match transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to match transactions" })),
            )
        })?;

        let matched_tx_id = match_result.map(|(id,)| id);

        // If no match found and auto-create is enabled, create a new expense
        // transaction from the statement line. The category stays NULL
        // ("Uncategorized"). The user can categorize it later.
        let matched_tx_id = if matched_tx_id.is_none() && auto_create {
            // Default posting. Cash is the source account, and the generic expense
            // account receives the debit.
            let source_account =
                crate::transaction_ledger::resolve_source_account(&state.pg_pool, None)
                    .await
                    .map_err(|e| {
                        error!("Failed to resolve source account: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to auto-create transaction" })),
                        )
                    })?;
            let source_name =
                crate::transaction_ledger::account_name(&state.pg_pool, source_account)
                    .await
                    .map_err(|e| {
                        error!("Failed to load source account name: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to auto-create transaction" })),
                        )
                    })?;
            let posting_account =
                crate::transaction_ledger::resolve_posting_account(&state.pg_pool, None, "expense")
                    .await
                    .map_err(|e| {
                        error!("Failed to resolve posting account: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to auto-create transaction" })),
                        )
                    })?;
            let posting_name =
                crate::transaction_ledger::account_name(&state.pg_pool, posting_account)
                    .await
                    .map_err(|e| {
                        error!("Failed to load posting account name: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to auto-create transaction" })),
                        )
                    })?;

            let mut db = state.pg_pool.begin().await.map_err(|e| {
                error!("Failed to begin DB transaction: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to auto-create transaction" })),
                )
            })?;

            let new_tx: Option<(Uuid,)> = sqlx::query_as(
                "INSERT INTO transactions (description, amount, type, date, account_id)
                 VALUES ($1, $2, 'expense', $3, $4)
                 RETURNING id",
            )
            .bind(line.description.trim())
            .bind(abs_amount)
            .bind(line.date)
            .bind(source_account)
            .fetch_optional(&mut *db)
            .await
            .map_err(|e| {
                error!("Failed to auto-create transaction from statement: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to auto-create transaction" })),
                )
            })?;

            if let Some((id,)) = new_tx {
                crate::transaction_ledger::post_entries(
                    &mut *db,
                    id,
                    "expense",
                    posting_account,
                    &posting_name,
                    source_account,
                    &source_name,
                    abs_amount,
                    line.description.trim(),
                )
                .await
                .map_err(|e| {
                    error!("Failed to post ledger entries: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to auto-create transaction" })),
                    )
                })?;

                sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
                    .bind(id)
                    .execute(&mut *db)
                    .await
                    .map_err(|e| {
                        error!("Failed to link ledger entries: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to auto-create transaction" })),
                        )
                    })?;
            }

            db.commit().await.map_err(|e| {
                error!("Failed to commit DB transaction: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to auto-create transaction" })),
                )
            })?;

            new_tx.map(|(id,)| id)
        } else {
            matched_tx_id
        };

        let match_status = if matched_tx_id.is_some() {
            matched_rows += 1;
            "matched"
        } else {
            unmatched_rows += 1;
            "unmatched"
        };

        let item: ReconciliationItem = sqlx::query_as(
            "INSERT INTO reconciliation_items
                (id, reconciliation_id, statement_date, statement_description, statement_amount,
                 match_status, matched_transaction_id, confidence)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, reconciliation_id, statement_date, statement_description,
                       statement_amount, match_status, matched_transaction_id, confidence",
        )
        .bind(Uuid::new_v4())
        .bind(recon_id)
        .bind(line.date)
        .bind(&line.description)
        .bind(signed_amount)
        .bind(match_status)
        .bind(matched_tx_id)
        .bind(if matched_tx_id.is_some() {
            Some(Decimal::from(95))
        } else {
            None
        })
        .fetch_one(&state.pg_pool)
        .await
        .map_err(|e| {
            error!("Failed to save reconciliation item: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save reconciliation item" })),
            )
        })?;

        items.push(item);
    }

    sqlx::query("UPDATE reconciliations SET matched_rows = $1, unmatched_rows = $2 WHERE id = $3")
        .bind(matched_rows as i32)
        .bind(unmatched_rows as i32)
        .bind(recon_id)
        .execute(&state.pg_pool)
        .await
        .ok();

    Ok(Json(ReconciliationUploadResponse {
        reconciliation_id: recon_id,
        total_rows: lines.len() as i64,
        matched_rows,
        unmatched_rows,
        items,
    }))
}

/// Uploads a raw CSV/OFX statement file and runs reconciliation on its rows.
#[utoipa::path(
    post,
    path = "/api/reconciliation/upload",
    tag = "Ledger",
    request_body(content = String, description = "multipart/form-data with `file`, optional `statement_name`, `format` (csv|ofx), and `auto_create_unmatched`"),
    responses(
        (status = 200, description = "Reconciliation completed", body = ReconciliationUploadResponse),
        (status = 400, description = "Invalid file or unsupported format"),
    ),
)]
pub async fn upload_reconciliation(
    State(state): State<AppState>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<ReconciliationUploadResponse>, (StatusCode, Json<serde_json::Value>)> {
    use crate::reconciliation_parser::{self, StatementFormat};

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut statement_name: Option<String> = None;
    let mut format: Option<String> = None;
    let mut auto_create = false;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("Failed to read multipart field: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Failed to read upload" })),
        )
    })? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                let filename = field.file_name().map(|s| s.to_string());
                let data = field.bytes().await.map_err(|e| {
                    error!("Failed to read file bytes: {}", e);
                    (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "Failed to read uploaded file" })),
                    )
                })?;
                if statement_name.is_none() {
                    statement_name = filename;
                }
                file_bytes = Some(data.to_vec());
            }
            "statement_name" => {
                statement_name = Some(field.text().await.unwrap_or_default().trim().to_string());
            }
            "format" => {
                format = Some(field.text().await.unwrap_or_default().trim().to_lowercase());
            }
            "auto_create_unmatched" => {
                let v = field.text().await.unwrap_or_default().trim().to_lowercase();
                auto_create = v == "true" || v == "1" || v == "yes";
            }
            _ => {}
        }
    }

    let data = file_bytes.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No file provided (field name: file)" })),
        )
    })?;

    let raw = String::from_utf8_lossy(&data).to_string();
    let fmt = match format.as_deref() {
        Some("csv") => StatementFormat::Csv,
        Some("ofx") => StatementFormat::Ofx,
        _ => reconciliation_parser::detect_format(&raw),
    };

    let lines = reconciliation_parser::parse_statement(&raw, fmt).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to parse statement: {}", e) })),
        )
    })?;

    let name = statement_name
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Statement upload".to_string());

    run_reconciliation(&state, &name, &lines, auto_create).await
}

/// Lists past reconciliations with their match statistics.
#[utoipa::path(
    get,
    path = "/api/reconciliation/history",
    tag = "Ledger",
    responses(
        (status = 200, description = "List of past reconciliations"),
    ),
)]
pub async fn reconciliation_history(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    #[derive(sqlx::FromRow, serde::Serialize)]
    struct HistoryRow {
        id: Uuid,
        statement_name: String,
        uploaded_at: chrono::DateTime<Utc>,
        total_rows: i32,
        matched_rows: i32,
        unmatched_rows: i32,
        status: String,
    }

    let rows: Vec<HistoryRow> = sqlx::query_as(
        "SELECT id, statement_name, uploaded_at, total_rows, matched_rows, unmatched_rows, status
         FROM reconciliations
         ORDER BY uploaded_at DESC
         LIMIT 100",
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch reconciliation history: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch reconciliation history" })),
        )
    })?;

    Ok(Json(json!({ "items": rows })))
}

/// Fetches all ledger entries from the DB.
async fn fetch_entries(pool: &PgPool) -> anyhow::Result<Vec<LedgerEntry>> {
    let rows: Vec<LedgerEntry> = sqlx::query_as(
        "SELECT e.id, e.transaction_id, e.account_id, a.name AS account_name,
                e.debit_amount, e.credit_amount, e.description, e.recorded_at
         FROM ledger_entries e
         LEFT JOIN accounts a ON a.id = e.account_id
         ORDER BY e.recorded_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows)
}
