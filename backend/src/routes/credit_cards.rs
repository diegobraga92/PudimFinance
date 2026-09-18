//! Credit-card accounts, billing cycles, and payments.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::{json, Value};
use sqlx::PgPool;
use tracing::{error, warn};
use uuid::Uuid;

use crate::ledger::{validate_balance, AccountMap};
use crate::models::{
    AnticipateInstallmentsRequest, AnticipateInstallmentsResponse, CardBill, CardOverview,
    CreateCardPurchaseRequest, PayCardBillRequest, PayCardBillResponse, Transaction,
};
use crate::state::AppState;

/// Routes for credit-card operations.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/credit-cards", get(list_credit_cards))
        .route("/api/credit-cards/{id}", get(get_credit_card))
        .route("/api/credit-cards/{id}/bills", get(list_card_bills))
        .route(
            "/api/credit-cards/{id}/purchases",
            axum::routing::post(create_card_purchase),
        )
        .route(
            "/api/credit-cards/{id}/bills/{bill_id}/pay",
            axum::routing::post(pay_card_bill),
        )
        .route(
            "/api/credit-cards/{id}/anticipate",
            axum::routing::post(anticipate_installments),
        )
}

// Billing cycle math

/// Adds `months` to a (year, month) pair, returning the new (year, month).
fn add_months_ym(year: i32, month: u32, months: i32) -> (i32, u32) {
    let total = year * 12 + (month as i32 - 1) + months;
    let y = total.div_euclid(12);
    let m0 = total.rem_euclid(12);
    (y, m0 as u32 + 1)
}

/// Number of days in a given month.
fn days_in_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(ny, nm, 1)
        .expect("first of month always valid")
        .pred_opt()
        .expect("month has a predecessor")
        .day()
}

/// Builds a date on `day` of the month, clamping `day` to the month's length.
fn date_with_day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day.min(days_in_month(year, month)))
        .expect("clamped day is always valid")
}

/// Returns the billing cycle and due date containing `d`.
fn cycle_for_date(
    closing_day: i16,
    due_day: i16,
    d: NaiveDate,
) -> (NaiveDate, NaiveDate, NaiveDate) {
    let closing_day = closing_day as u32;
    let due_day = due_day as u32;

    let candidate = date_with_day(d.year(), d.month(), closing_day);
    let period_end = if candidate >= d {
        candidate
    } else {
        let (ny, nm) = add_months_ym(d.year(), d.month(), 1);
        date_with_day(ny, nm, closing_day)
    };

    let (py, pm) = add_months_ym(period_end.year(), period_end.month(), -1);
    let prev_close = date_with_day(py, pm, closing_day);
    let period_start = prev_close
        .succ_opt()
        .expect("day after a date is always valid");

    let cand = date_with_day(period_end.year(), period_end.month(), due_day);
    let due_date = if cand >= period_end {
        cand
    } else {
        let (ny, nm) = add_months_ym(period_end.year(), period_end.month(), 1);
        date_with_day(ny, nm, due_day)
    };

    (period_start, period_end, due_date)
}

#[cfg(test)]
mod cycle_tests {
    use super::*;

    fn cyc(c: i16, d: i16, date: NaiveDate) -> (NaiveDate, NaiveDate, NaiveDate) {
        cycle_for_date(c, d, date)
    }

    #[test]
    fn closing_before_purchase_same_month() {
        // closing day 5, purchase on Jan 20 -> cycle Jan 6..Feb 5, due Feb 15
        let (start, end, due) = cyc(5, 15, NaiveDate::from_ymd_opt(2026, 1, 20).unwrap());
        assert_eq!(start, NaiveDate::from_ymd_opt(2026, 1, 6).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2026, 2, 5).unwrap());
        assert_eq!(due, NaiveDate::from_ymd_opt(2026, 2, 15).unwrap());
    }

    #[test]
    fn purchase_before_closing_same_month() {
        // closing day 5, purchase on Jan 3 -> cycle Dec 6..Jan 5, due Jan 15
        let (start, end, due) = cyc(5, 15, NaiveDate::from_ymd_opt(2026, 1, 3).unwrap());
        assert_eq!(start, NaiveDate::from_ymd_opt(2025, 12, 6).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2026, 1, 5).unwrap());
        assert_eq!(due, NaiveDate::from_ymd_opt(2026, 1, 15).unwrap());
    }

    #[test]
    fn due_before_closing_rolls_to_next_month() {
        // closing day 20, due day 10 -> due the month after closing
        let (start, end, due) = cyc(20, 10, NaiveDate::from_ymd_opt(2026, 1, 25).unwrap());
        assert_eq!(start, NaiveDate::from_ymd_opt(2026, 1, 21).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2026, 2, 20).unwrap());
        assert_eq!(due, NaiveDate::from_ymd_opt(2026, 3, 10).unwrap());
    }

    #[test]
    fn day_31_clamps_short_months() {
        // closing day 31 -> clamped to Feb 28 in a non-leap year
        let (_, end, _) = cyc(31, 10, NaiveDate::from_ymd_opt(2026, 2, 15).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
    }

    #[test]
    fn year_boundary() {
        // purchase Dec 30, closing day 25 -> cycle Dec 26..Jan 25, due Feb 10
        let (start, end, due) = cyc(25, 10, NaiveDate::from_ymd_opt(2025, 12, 30).unwrap());
        assert_eq!(start, NaiveDate::from_ymd_opt(2025, 12, 26).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2026, 1, 25).unwrap());
        assert_eq!(due, NaiveDate::from_ymd_opt(2026, 2, 10).unwrap());
    }
}

// Shared DB helpers

/// Fetches a card account (a `liability` account with `due_day` set).
/// Returns `(name, closing_day, due_day)`.
async fn fetch_card(
    pool: &PgPool,
    id: Uuid,
) -> Result<(String, Option<i16>, Option<i16>), (StatusCode, Json<Value>)> {
    let row: Option<(String, Option<i16>, Option<i16>)> =
        sqlx::query_as("SELECT name, closing_day, due_day FROM accounts WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                error!("Failed to fetch credit card: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to fetch credit card" })),
                )
            })?;

    match row {
        Some((name, closing_day, due_day)) => Ok((name, closing_day, due_day)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Credit card not found" })),
        )),
    }
}

/// Loads an expense ledger account for a category name, falling back to Miscellaneous.
async fn expense_account_for(
    pool: &PgPool,
    account_map: &AccountMap,
    category_id: Option<Uuid>,
) -> Result<Uuid, (StatusCode, Json<Value>)> {
    let paired_name = if let Some(cid) = category_id {
        let name: Option<String> = sqlx::query_scalar("SELECT name FROM categories WHERE id = $1")
            .bind(cid)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                error!("Failed to look up category: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to look up category" })),
                )
            })?;
        name.unwrap_or_else(|| "Miscellaneous".to_string())
    } else {
        "Miscellaneous".to_string()
    };

    let paired = account_map
        .get(&paired_name)
        .or_else(|| account_map.get("Miscellaneous"));

    match paired {
        Some((id, _)) => Ok(id),
        None => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "No expense account configured for this category" })),
        )),
    }
}

/// Ensures a `card_bills` row exists for the cycle containing `date`, returning its id.
async fn upsert_bill(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    card_id: Uuid,
    closing_day: i16,
    due_day: i16,
    date: NaiveDate,
) -> Result<Uuid, sqlx::Error> {
    let (period_start, period_end, due_date) = cycle_for_date(closing_day, due_day, date);
    let bill_id: Uuid = sqlx::query_scalar(
        "INSERT INTO card_bills (card_id, period_start, period_end, due_date)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (card_id, period_end) DO UPDATE SET period_start = EXCLUDED.period_start,
                                                         due_date = EXCLUDED.due_date
         RETURNING id",
    )
    .bind(card_id)
    .bind(period_start)
    .bind(period_end)
    .bind(due_date)
    .fetch_one(&mut **tx)
    .await?;
    Ok(bill_id)
}

/// Inserts a `CreditCard` event into the immutable event log.
async fn insert_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    aggregate_id: Uuid,
    event_type: &str,
    payload: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO events (aggregate_id, aggregate_type, event_type, payload)
         VALUES ($1, 'CreditCard', $2, $3)",
    )
    .bind(aggregate_id)
    .bind(event_type)
    .bind(payload)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Fetches a bill by id (with computed totals).
async fn fetch_bill_by_id(
    pool: &PgPool,
    bill_id: Uuid,
) -> Result<Option<CardBill>, (StatusCode, Json<Value>)> {
    let bill: Option<CardBill> = sqlx::query_as::<_, CardBill>(
        "SELECT b.id, b.card_id, b.period_start, b.period_end, b.due_date, b.status,
                b.paid_amount, b.paid_at,
                COALESCE((
                    SELECT SUM(t.amount) FROM transactions t
                    WHERE t.account_id = b.card_id
                      AND t.type = 'expense'
                      AND t.date >= b.period_start
                      AND t.date <= b.period_end
                ), 0)::numeric AS total_amount,
                COALESCE((
                    SELECT SUM(t.amount) FROM transactions t
                    WHERE t.account_id = b.card_id
                      AND t.type = 'expense'
                      AND t.date >= b.period_start
                      AND t.date <= b.period_end
                ), 0)::numeric - b.paid_amount AS remaining_amount
         FROM card_bills b
         WHERE b.id = $1",
    )
    .bind(bill_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch bill: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch bill" })),
        )
    })?;
    Ok(bill)
}

/// Fetches the most recent open bill that has already started for a card.
async fn fetch_current_bill(
    pool: &PgPool,
    card_id: Uuid,
    today: NaiveDate,
) -> Result<Option<CardBill>, (StatusCode, Json<Value>)> {
    let bill: Option<CardBill> = sqlx::query_as::<_, CardBill>(
        "SELECT b.id, b.card_id, b.period_start, b.period_end, b.due_date, b.status,
                b.paid_amount, b.paid_at,
                COALESCE((
                    SELECT SUM(t.amount) FROM transactions t
                    WHERE t.account_id = b.card_id
                      AND t.type = 'expense'
                      AND t.date >= b.period_start
                      AND t.date <= b.period_end
                ), 0)::numeric AS total_amount,
                COALESCE((
                    SELECT SUM(t.amount) FROM transactions t
                    WHERE t.account_id = b.card_id
                      AND t.type = 'expense'
                      AND t.date >= b.period_start
                      AND t.date <= b.period_end
                ), 0)::numeric - b.paid_amount AS remaining_amount
         FROM card_bills b
         WHERE b.card_id = $1 AND b.status = 'open' AND b.period_start <= $2
         ORDER BY b.period_end DESC
         LIMIT 1",
    )
    .bind(card_id)
    .bind(today)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch current bill: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch current bill" })),
        )
    })?;
    Ok(bill)
}

/// Lists credit-card accounts with balances and their current open bill.
#[utoipa::path(
    get,
    path = "/api/credit-cards",
    tag = "Credit Cards",
    responses(
        (status = 200, description = "List of credit cards with balances", body = [CardOverview]),
    ),
)]
pub async fn list_credit_cards(
    State(state): State<AppState>,
) -> Result<Json<Vec<CardOverview>>, (StatusCode, Json<Value>)> {
    #[derive(sqlx::FromRow)]
    struct CardRow {
        id: Uuid,
        name: String,
        closing_day: Option<i16>,
        due_day: Option<i16>,
        credit_limit: Option<Decimal>,
        balance: Decimal,
    }

    let rows: Vec<CardRow> = sqlx::query_as(
        "SELECT a.id, a.name, a.closing_day, a.due_day, a.credit_limit,
                COALESCE(SUM(e.debit_amount) - SUM(e.credit_amount), 0) AS balance
         FROM accounts a
         LEFT JOIN ledger_entries e ON e.account_id = a.id
         WHERE a.type = 'liability' AND a.account_kind = 'card'
         GROUP BY a.id
         ORDER BY a.name",
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list credit cards: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list credit cards" })),
        )
    })?;

    let today = Utc::now().date_naive();
    let mut cards = Vec::with_capacity(rows.len());
    for r in rows {
        let current_bill = fetch_current_bill(&state.pg_pool, r.id, today).await?;
        cards.push(CardOverview {
            id: r.id,
            name: r.name,
            closing_day: r.closing_day,
            due_day: r.due_day,
            credit_limit: r.credit_limit,
            balance: r.balance,
            current_bill,
        });
    }

    Ok(Json(cards))
}

/// Returns a single credit card with its card fields and balance.
#[utoipa::path(
    get,
    path = "/api/credit-cards/{id}",
    tag = "Credit Cards",
    params(
        ("id" = Uuid, Path, description = "Card account UUID"),
    ),
    responses(
        (status = 200, description = "Credit card found", body = CardOverview),
        (status = 404, description = "Credit card not found"),
    ),
)]
pub async fn get_credit_card(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<CardOverview>, (StatusCode, Json<Value>)> {
    let (name, closing_day, due_day) = fetch_card(&state.pg_pool, id).await?;

    #[derive(sqlx::FromRow)]
    struct BalanceRow {
        balance: Decimal,
    }
    let balance: BalanceRow = sqlx::query_as(
        "SELECT COALESCE(SUM(debit_amount) - SUM(credit_amount), 0) AS balance
         FROM ledger_entries WHERE account_id = $1",
    )
    .bind(id)
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to compute card balance: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to compute card balance" })),
        )
    })?;

    let credit_limit: Option<Decimal> =
        sqlx::query_scalar("SELECT credit_limit FROM accounts WHERE id = $1")
            .bind(id)
            .fetch_one(&state.pg_pool)
            .await
            .map_err(|e| {
                error!("Failed to fetch credit limit: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to fetch credit limit" })),
                )
            })?;

    let today = Utc::now().date_naive();
    let current_bill = fetch_current_bill(&state.pg_pool, id, today).await?;

    Ok(Json(CardOverview {
        id,
        name,
        closing_day,
        due_day,
        credit_limit,
        balance: balance.balance,
        current_bill,
    }))
}

/// Lists all billing cycles for a credit card with computed totals.
#[utoipa::path(
    get,
    path = "/api/credit-cards/{id}/bills",
    tag = "Credit Cards",
    params(
        ("id" = Uuid, Path, description = "Card account UUID"),
    ),
    responses(
        (status = 200, description = "List of card bills", body = [CardBill]),
        (status = 404, description = "Credit card not found"),
    ),
)]
pub async fn list_card_bills(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<CardBill>>, (StatusCode, Json<Value>)> {
    let _ = fetch_card(&state.pg_pool, id).await?;

    let bills: Vec<CardBill> = sqlx::query_as::<_, CardBill>(
        "SELECT b.id, b.card_id, b.period_start, b.period_end, b.due_date, b.status,
                b.paid_amount, b.paid_at,
                COALESCE((
                    SELECT SUM(t.amount) FROM transactions t
                    WHERE t.account_id = b.card_id
                      AND t.type = 'expense'
                      AND t.date >= b.period_start
                      AND t.date <= b.period_end
                ), 0)::numeric AS total_amount,
                COALESCE((
                    SELECT SUM(t.amount) FROM transactions t
                    WHERE t.account_id = b.card_id
                      AND t.type = 'expense'
                      AND t.date >= b.period_start
                      AND t.date <= b.period_end
                ), 0)::numeric - b.paid_amount AS remaining_amount
         FROM card_bills b
         WHERE b.card_id = $1
         ORDER BY b.period_end DESC",
    )
    .bind(id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to list card bills: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to list card bills" })),
        )
    })?;

    Ok(Json(bills))
}

/// Records a purchase on a credit card.
///
/// Atomically creates the expense `transaction` (dated at purchase time, so it
/// counts in that month's expenses), posts balanced ledger entries (debit the
/// expense account, credit the card), and attaches it to the matching bill.
#[utoipa::path(
    post,
    path = "/api/credit-cards/{id}/purchases",
    tag = "Credit Cards",
    params(
        ("id" = Uuid, Path, description = "Card account UUID"),
    ),
    request_body = CreateCardPurchaseRequest,
    responses(
        (status = 201, description = "Purchase recorded", body = Transaction),
        (status = 400, description = "Invalid purchase payload"),
        (status = 404, description = "Credit card not found"),
    ),
)]
pub async fn create_card_purchase(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateCardPurchaseRequest>,
) -> Result<(StatusCode, Json<Transaction>), (StatusCode, Json<Value>)> {
    let description = payload.description.trim().to_string();
    if description.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "description must not be empty" })),
        ));
    }
    if payload.amount <= Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "amount must be greater than zero" })),
        ));
    }

    let (_, closing_day, due_day) = fetch_card(&state.pg_pool, id).await?;
    let (closing_day, due_day) = match (closing_day, due_day) {
        (Some(c), Some(d)) => (c, d),
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Card has no closing_day/due_day configured" })),
            ))
        }
    };

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

    let purchase_date = payload.date.unwrap_or_else(|| Utc::now().date_naive());
    let account_map = AccountMap::load(&state.pg_pool).await.map_err(|e| {
        error!("Failed to load chart of accounts: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to load chart of accounts" })),
        )
    })?;
    let expense_account =
        expense_account_for(&state.pg_pool, &account_map, payload.category_id).await?;

    let mut tx = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    // 1. Simple transaction that drives monthly expense totals.
    let transaction: Transaction = sqlx::query_as(
        "INSERT INTO transactions (description, amount, type, category_id, date, notes, installment_plan_id, account_id)
         VALUES ($1, $2, 'expense', $3, $4, $5, $6, $7)
         RETURNING id, description, amount, type, category_id, date, notes,
                   installment_plan_id, account_id, created_at, updated_at",
    )
    .bind(&description)
    .bind(payload.amount)
    .bind(payload.category_id)
    .bind(purchase_date)
    .bind(&payload.notes)
    .bind(payload.installment_plan_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        error!("Failed to record card purchase: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to record card purchase" })),
        )
    })?;

    // 2. Balanced ledger entries that debit the expense account and credit the card.
    let debits = vec![payload.amount, Decimal::ZERO];
    let credits = vec![Decimal::ZERO, payload.amount];
    validate_balance(&debits, &credits).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;
    sqlx::query(
        "INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
         VALUES ($1, $2, $3, 0, $4), ($1, $5, 0, $3, $6)",
    )
    .bind(transaction.id)
    .bind(expense_account)
    .bind(payload.amount)
    .bind(format!("{description} (expense)"))
    .bind(id)
    .bind(format!("{description} (credit card)"))
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        error!("Failed to post ledger entries: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to post ledger entries" })),
        )
    })?;

    // Link the transaction to its ledger group (same id) so later updates and
    // deletes can find its entries.
    sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
        .bind(transaction.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            error!("Failed to link ledger entries: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to link ledger entries" })),
            )
        })?;

    // 3. Attach to the matching billing cycle.
    let bill_id = upsert_bill(&mut tx, id, closing_day, due_day, purchase_date)
        .await
        .map_err(|e| {
            error!("Failed to upsert card bill: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to attach purchase to bill" })),
            )
        })?;

    // 4. Event sourcing.
    insert_event(
        &mut tx,
        transaction.id,
        "CardPurchaseRecorded",
        json!({
            "card_id": id.to_string(),
            "bill_id": bill_id.to_string(),
            "amount": payload.amount.to_string(),
            "date": purchase_date.to_string(),
        }),
    )
    .await
    .map_err(|e| {
        error!("Failed to store event: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to store event" })),
        )
    })?;

    tx.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit transaction" })),
        )
    })?;

    Ok((StatusCode::CREATED, Json(transaction)))
}

/// Pays a credit-card bill.
///
/// Records the payment as a transfer, debiting the card and crediting the paying
/// account. It is never an expense, and it updates the bill's settlement state.
#[utoipa::path(
    post,
    path = "/api/credit-cards/{id}/bills/{bill_id}/pay",
    tag = "Credit Cards",
    params(
        ("id" = Uuid, Path, description = "Card account UUID"),
        ("bill_id" = Uuid, Path, description = "Bill UUID"),
    ),
    request_body = PayCardBillRequest,
    responses(
        (status = 200, description = "Bill paid", body = PayCardBillResponse),
        (status = 400, description = "Invalid payment payload"),
        (status = 404, description = "Credit card or bill not found"),
    ),
)]
pub async fn pay_card_bill(
    State(state): State<AppState>,
    Path((id, bill_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<PayCardBillRequest>,
) -> Result<Json<PayCardBillResponse>, (StatusCode, Json<Value>)> {
    let _ = fetch_card(&state.pg_pool, id).await?;

    // Use the explicit bill when provided, otherwise the current open bill.
    let target_bill_id = payload.bill_id.unwrap_or(bill_id);
    let bill = {
        let b = fetch_bill_by_id(&state.pg_pool, target_bill_id).await?;
        match b {
            Some(b) if b.card_id == id => b,
            Some(_) => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": "Bill does not belong to this card" })),
                ))
            }
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": "Bill not found" })),
                ))
            }
        }
    };

    let remaining = bill.total_amount - bill.paid_amount;
    if remaining <= Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "This bill is already fully paid" })),
        ));
    }
    let amount = payload.amount.unwrap_or(remaining);
    if amount <= Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "amount must be greater than zero" })),
        ));
    }
    if amount > remaining {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "amount exceeds the remaining bill balance" })),
        ));
    }

    let from_account_id = match payload.from_account_id {
        Some(aid) => {
            let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM accounts WHERE id = $1")
                .bind(aid)
                .fetch_optional(&state.pg_pool)
                .await
                .map_err(|e| {
                    error!("Failed to validate paying account: {e}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to validate paying account" })),
                    )
                })?;
            match exists {
                Some(_) => aid,
                None => {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        Json(
                            json!({ "error": "from_account_id does not reference an existing account" }),
                        ),
                    ))
                }
            }
        }
        None => {
            let map = AccountMap::load(&state.pg_pool).await.map_err(|e| {
                error!("Failed to load chart of accounts: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to load chart of accounts" })),
                )
            })?;
            match map.cash_account() {
                Some((cid, _)) => cid,
                None => {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "No 'Cash' account found; pass from_account_id" })),
                    ))
                }
            }
        }
    };

    let mut tx = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    let txid = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
         VALUES ($1, $2, $3, 0, $4), ($1, $5, 0, $3, $4)",
    )
    .bind(txid)
    .bind(id) // debit the card (reduces the liability)
    .bind(amount)
    .bind(format!("Card payment — bill due {}", bill.due_date))
    .bind(from_account_id) // credit the paying account
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        error!("Failed to post card payment: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to post card payment" })),
        )
    })?;

    let new_paid = bill.paid_amount + amount;
    let status = if new_paid >= bill.total_amount {
        "paid"
    } else {
        "open"
    };
    let paid_at: Option<chrono::DateTime<Utc>> = if status == "paid" {
        Some(Utc::now())
    } else {
        None
    };

    sqlx::query("UPDATE card_bills SET paid_amount = $1, status = $2, paid_at = $3 WHERE id = $4")
        .bind(new_paid)
        .bind(status)
        .bind(paid_at)
        .bind(bill.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            error!("Failed to update bill: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to update bill" })),
            )
        })?;

    insert_event(
        &mut tx,
        bill.id,
        "CardBillPaymentRecorded",
        json!({
            "card_id": id.to_string(),
            "amount": amount.to_string(),
            "from_account_id": from_account_id.to_string(),
        }),
    )
    .await
    .map_err(|e| {
        error!("Failed to store event: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to store event" })),
        )
    })?;

    tx.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit transaction" })),
        )
    })?;

    let updated = fetch_bill_by_id(&state.pg_pool, bill.id)
        .await?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Bill disappeared after payment" })),
            )
        })?;

    Ok(Json(PayCardBillResponse {
        bill: updated.clone(),
        amount_paid: amount,
        remaining: updated.remaining_amount,
    }))
}

/// Anticipates (pays early) future installments on a credit card.
///
/// Selected future installments are charged on the current bill (optionally
/// with a discount, as offered by many providers). Their expense transactions
/// are re-dated/re-priced into the current billing period, so they count in
/// this month's expenses and disappear from future months/bills.
#[utoipa::path(
    post,
    path = "/api/credit-cards/{id}/anticipate",
    tag = "Credit Cards",
    params(
        ("id" = Uuid, Path, description = "Card account UUID"),
    ),
    request_body = AnticipateInstallmentsRequest,
    responses(
        (status = 200, description = "Installments anticipated", body = AnticipateInstallmentsResponse),
        (status = 400, description = "Invalid anticipation payload"),
        (status = 404, description = "Credit card not found"),
    ),
)]
pub async fn anticipate_installments(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<AnticipateInstallmentsRequest>,
) -> Result<Json<AnticipateInstallmentsResponse>, (StatusCode, Json<Value>)> {
    if payload.installment_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "installment_ids must not be empty" })),
        ));
    }
    if payload.discount_percent.is_some() && payload.discount_amount.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Provide either discount_percent or discount_amount, not both"
            })),
        ));
    }

    let (_, closing_day, due_day) = fetch_card(&state.pg_pool, id).await?;
    let (closing_day, due_day) = match (closing_day, due_day) {
        (Some(c), Some(d)) => (c, d),
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Card has no closing_day/due_day configured" })),
            ))
        }
    };

    #[derive(sqlx::FromRow)]
    struct InstRow {
        id: Uuid,
        plan_id: Uuid,
        installment_number: i32,
        due_date: NaiveDate,
        status: String,
        anticipated_at: Option<chrono::DateTime<Utc>>,
        transaction_id: Option<Uuid>,
        tx_date: Option<NaiveDate>,
        tx_amount: Option<Decimal>,
        plan_account_id: Option<Uuid>,
        installment_amount: Decimal,
        category_id: Option<Uuid>,
        plan_description: String,
        installments_total: i32,
    }

    let rows: Vec<InstRow> = sqlx::query_as(
        "SELECT it.id, it.plan_id, it.installment_number, it.due_date, it.status,
                it.anticipated_at, it.transaction_id, t.date AS tx_date,
                t.amount AS tx_amount, ip.account_id AS plan_account_id,
                ip.installment_amount, ip.category_id, ip.description AS plan_description,
                ip.installments AS installments_total
         FROM installment_transactions it
         JOIN installment_plans ip ON ip.id = it.plan_id
         LEFT JOIN transactions t ON t.id = it.transaction_id
         WHERE it.id = ANY($1)
         ORDER BY it.due_date",
    )
    .bind(&payload.installment_ids)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch installments: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch installments" })),
        )
    })?;

    if rows.len() != payload.installment_ids.len() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Some installment_ids do not exist" })),
        ));
    }

    let today = Utc::now().date_naive();
    let mut gross = Decimal::ZERO;
    for r in &rows {
        // Each installment must belong to a plan linked to this card.
        if r.plan_account_id != Some(id) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(
                    json!({ "error": "All installments must belong to plans linked to this card" }),
                ),
            ));
        }
        if r.anticipated_at.is_some() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "One or more installments were already anticipated" })),
            ));
        }
        if r.status == "paid" {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Cannot anticipate a paid installment" })),
            ));
        }
        // Must be a future installment (not already charged in a bill).
        // Pending installments (no linked transaction yet) are judged by
        // their scheduled due date.
        let when = r.tx_date.unwrap_or(r.due_date);
        if when <= today {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(
                    json!({ "error": "Cannot anticipate an installment that is not in the future" }),
                ),
            ));
        }
        let amt = r.tx_amount.unwrap_or(r.installment_amount);
        gross += amt;
    }

    let discount = if let Some(p) = payload.discount_percent {
        if p < Decimal::ZERO || p > Decimal::from(100) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "discount_percent must be between 0 and 100" })),
            ));
        }
        (gross * p) / Decimal::from(100)
    } else {
        payload.discount_amount.unwrap_or(Decimal::ZERO)
    };
    if discount < Decimal::ZERO {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "discount_amount must be greater than or equal to zero" })),
        ));
    }
    if discount >= gross {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "discount must be less than the gross amount" })),
        ));
    }
    let net = gross - discount;

    let mut tx = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    // Charge the anticipated installments on the current bill.
    let bill_id = upsert_bill(&mut tx, id, closing_day, due_day, today)
        .await
        .map_err(|e| {
            error!("Failed to upsert current bill: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create current bill" })),
            )
        })?;

    let anticipation_id: Uuid = sqlx::query_scalar(
        "INSERT INTO installment_anticipations (card_id, bill_id, gross_amount, discount_amount, net_amount)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
    )
    .bind(id)
    .bind(bill_id)
    .bind(gross)
    .bind(discount)
    .bind(net)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        error!("Failed to create anticipation record: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create anticipation record" })),
        )
    })?;

    let mut anticipated_count: i64 = 0;

    for r in &rows {
        let original_amount = r.tx_amount.unwrap_or(r.installment_amount);
        // Distribute the discount proportionally, rounding to cents.
        let discounted_amount = if gross > Decimal::ZERO {
            (original_amount * net / gross).round_dp(2)
        } else {
            original_amount
        };

        // 1. Move/price the expense into the current billing period.
        let tx_id = if let Some(existing_id) = r.transaction_id {
            sqlx::query(
                "UPDATE transactions
                 SET date = $1, amount = $2, account_id = $3, updated_at = NOW()
                 WHERE id = $4",
            )
            .bind(today)
            .bind(discounted_amount)
            .bind(id)
            .bind(existing_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                error!("Failed to re-date installment transaction: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to re-date installment transaction" })),
                )
            })?;

            // The amount may have been discounted, so re-post the ledger entries.
            let (desc, amt): (String, Decimal) =
                sqlx::query_as("SELECT description, amount FROM transactions WHERE id = $1")
                    .bind(existing_id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(|e| {
                        error!("Failed to fetch re-priced transaction: {e}");
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to re-date installment transaction" })),
                        )
                    })?;
            let old_ledger: Option<Uuid> =
                sqlx::query_scalar("SELECT ledger_transaction_id FROM transactions WHERE id = $1")
                    .bind(existing_id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(|e| {
                        error!("Failed to fetch ledger link: {e}");
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to re-date installment transaction" })),
                        )
                    })?;
            crate::transaction_ledger::delete_entries(&mut *tx, existing_id, old_ledger).await;
            let posting_account = crate::transaction_ledger::resolve_posting_account(
                &state.pg_pool,
                r.category_id,
                "expense",
            )
            .await
            .map_err(|e| {
                error!("Failed to resolve posting account: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to re-date installment transaction" })),
                )
            })?;
            let posting_name =
                crate::transaction_ledger::account_name(&state.pg_pool, posting_account)
                    .await
                    .map_err(|e| {
                        error!("Failed to load posting account name: {e}");
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to re-date installment transaction" })),
                        )
                    })?;
            let source_name = crate::transaction_ledger::account_name(&state.pg_pool, id)
                .await
                .map_err(|e| {
                    error!("Failed to load card name: {e}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to re-date installment transaction" })),
                    )
                })?;
            crate::transaction_ledger::post_entries(
                &mut *tx,
                existing_id,
                "expense",
                posting_account,
                &posting_name,
                id,
                &source_name,
                amt,
                &desc,
            )
            .await
            .map_err(|e| {
                error!("Failed to re-post ledger entries: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to re-date installment transaction" })),
                )
            })?;
            sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
                .bind(existing_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    error!("Failed to link ledger entries: {e}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to re-date installment transaction" })),
                    )
                })?;
            existing_id
        } else {
            let description = format!(
                "Parcela {}/{} — {}",
                r.installment_number, r.installments_total, r.plan_description
            );
            let new_id: Uuid = sqlx::query_scalar(
                "INSERT INTO transactions
                    (description, amount, type, category_id, date, installment_plan_id, account_id)
                 VALUES ($1, $2, 'expense', $3, $4, $5, $6)
                 RETURNING id",
            )
            .bind(&description)
            .bind(discounted_amount)
            .bind(r.category_id)
            .bind(today)
            .bind(r.plan_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| {
                error!("Failed to create anticipated installment transaction: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        json!({ "error": "Failed to create anticipated installment transaction" }),
                    ),
                )
            })?;

            // Post ledger entries for the anticipated expense and link them.
            let posting_account = crate::transaction_ledger::resolve_posting_account(
                &state.pg_pool,
                r.category_id,
                "expense",
            )
            .await
            .map_err(|e| {
                error!("Failed to resolve posting account: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        json!({ "error": "Failed to create anticipated installment transaction" }),
                    ),
                )
            })?;
            let posting_name = crate::transaction_ledger::account_name(
                &state.pg_pool,
                posting_account,
            )
            .await
            .map_err(|e| {
                error!("Failed to load posting account name: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        json!({ "error": "Failed to create anticipated installment transaction" }),
                    ),
                )
            })?;
            let source_name = crate::transaction_ledger::account_name(&state.pg_pool, id)
                .await
                .map_err(|e| {
                    error!("Failed to load card name: {e}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(
                            json!({ "error": "Failed to create anticipated installment transaction" }),
                        ),
                    )
                })?;
            crate::transaction_ledger::post_entries(
                &mut *tx,
                new_id,
                "expense",
                posting_account,
                &posting_name,
                id,
                &source_name,
                discounted_amount,
                &description,
            )
            .await
            .map_err(|e| {
                error!("Failed to post ledger entries: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        json!({ "error": "Failed to create anticipated installment transaction" }),
                    ),
                )
            })?;
            sqlx::query("UPDATE transactions SET ledger_transaction_id = $1 WHERE id = $1")
                .bind(new_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    error!("Failed to link ledger entries: {e}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(
                            json!({ "error": "Failed to create anticipated installment transaction" }),
                        ),
                    )
                })?;
            new_id
        };

        // 2. Mark the installment as anticipated and link it to the bill.
        sqlx::query(
            "UPDATE installment_transactions
             SET anticipated_at = NOW(), anticipated_bill_id = $1, transaction_id = $2
             WHERE id = $3",
        )
        .bind(bill_id)
        .bind(tx_id)
        .bind(r.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            error!("Failed to mark installment as anticipated: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to mark installment as anticipated" })),
            )
        })?;

        // 3. Audit trail item.
        sqlx::query(
            "INSERT INTO installment_anticipation_items
                (anticipation_id, installment_transaction_id, original_due_date, original_amount, discounted_amount)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(anticipation_id)
        .bind(r.id)
        .bind(r.due_date)
        .bind(original_amount)
        .bind(discounted_amount)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            error!("Failed to record anticipation item: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to record anticipation item" })),
            )
        })?;

        anticipated_count += 1;
    }

    insert_event(
        &mut tx,
        anticipation_id,
        "InstallmentsAnticipated",
        json!({
            "card_id": id.to_string(),
            "bill_id": bill_id.to_string(),
            "gross_amount": gross.to_string(),
            "discount_amount": discount.to_string(),
            "net_amount": net.to_string(),
            "installment_ids": rows.iter().map(|r| r.id.to_string()).collect::<Vec<_>>(),
        }),
    )
    .await
    .map_err(|e| {
        error!("Failed to store event: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to store event" })),
        )
    })?;

    tx.commit().await.map_err(|e| {
        error!("Failed to commit DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit transaction" })),
        )
    })?;

    warn!(
        "Anticipated {} installments on card {} (gross {}, discount {}, net {})",
        anticipated_count, id, gross, discount, net
    );

    Ok(Json(AnticipateInstallmentsResponse {
        bill_id,
        gross_amount: gross,
        discount_amount: discount,
        net_amount: net,
        installments_anticipated: anticipated_count,
    }))
}
