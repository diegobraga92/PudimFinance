//! Transaction CRUD endpoints.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::AssertSqlSafe;
use tracing::error;
use uuid::Uuid;

use crate::models::{
    CreateTransactionRequest, Transaction, TransactionListParams, TransactionListResponse,
    UpdateTransactionRequest,
};
use crate::routes::{credit_cards, settings};
use crate::state::AppState;
use crate::transaction_ledger;
use sqlx::{PgConnection, PgPool};

/// Routes for transaction operations.
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

/// Lists filtered and paginated transactions.
#[utoipa::path(
    get,
    path = "/api/transactions",
    tag = "Transactions",
    params(
        ("page_size" = Option<u32>, Query, description = "Page size (default 50, max 200)"),
        ("page" = Option<u32>, Query, description = "Page offset (default 0)"),
        ("include_subcategories" = Option<bool>, Query, description = "Include descendants of category_id"),
        ("category_id" = Option<Uuid>, Query, description = "Filter by category UUID"),
        ("type" = Option<String>, Query, description = "Filter by 'income' or 'expense'"),
        ("start_date" = Option<String>, Query, description = "Filter by start date (inclusive)"),
        ("end_date" = Option<String>, Query, description = "Filter by end date (inclusive)"),
        ("account_id" = Option<Uuid>, Query, description = "Filter by source account UUID"),
        ("sort" = Option<String>, Query, description = "Sort by date, description, amount, category, or account"),
        ("order" = Option<String>, Query, description = "Sort direction: asc or desc"),
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

    let sort = params.sort.as_deref().unwrap_or("date");
    if !matches!(
        sort,
        "date" | "description" | "amount" | "category" | "account"
    ) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid sort field" })),
        ));
    }
    let order = params.order.as_deref().unwrap_or("desc");
    if !matches!(order, "asc" | "desc") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "order must be 'asc' or 'desc'" })),
        ));
    }

    // Use the nullable bind pattern `$1::uuid[] IS NULL OR category_id = ANY($1)`
    // to allow a single static SQL query with optional exact or subtree filters.
    //
    // Date filters compare the *reporting* date
    // (`effective_transaction_date`), so the list matches the dashboard,
    // budgets and reports: with the `due_date` preference a card purchase made
    // shortly before the closing date is listed in the month its bill is due.
    // The extra `t.date` predicates are exact pre-filters (a reporting date is
    // never earlier than its transaction, nor more than a cycle later) that
    // keep the date index usable.
    let category_ids = if let Some(category_id) = params.category_id {
        if params.include_subcategories {
            Some(
                category_subtree_ids(&state.pg_pool, category_id)
                    .await
                    .map_err(|e| {
                        error!("Failed to resolve category descendants: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to resolve category filter" })),
                        )
                    })?,
            )
        } else {
            Some(vec![category_id])
        }
    } else {
        None
    };
    let dating = settings::card_expense_dating(&state.pg_pool).await;
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM transactions t
         WHERE ($1::uuid[] IS NULL OR t.category_id = ANY($1))
           AND ($2::text IS NULL OR t.type = $2)
           AND ($3::date IS NULL OR t.date >= $3 - INTERVAL '3 months')
           AND ($4::date IS NULL OR t.date <= $4)
           AND ($5::uuid IS NULL OR t.account_id = $5)
           AND ($3::date IS NULL OR effective_transaction_date(t.date, t.account_id, $6, t.card_bill_period_end) >= $3)
           AND ($4::date IS NULL OR effective_transaction_date(t.date, t.account_id, $6, t.card_bill_period_end) <= $4)",
    )
    .bind(&category_ids)
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

    let sort_column = match sort {
        "description" => "t.description",
        "amount" => "t.amount",
        "category" => "COALESCE(c.name, '')",
        "account" => "COALESCE(a.name, '')",
        _ => "effective_transaction_date(t.date, t.account_id, $8, t.card_bill_period_end)",
    };
    let sort_direction = if order == "asc" { "ASC" } else { "DESC" };
    let order_sql = format!(
        "{} {} NULLS LAST, t.id {}",
        sort_column, sort_direction, sort_direction
    );
    let query = format!(
        "SELECT t.id, t.description, t.amount, t.type, t.category_id, t.date, t.notes,
                t.installment_plan_id, t.account_id, t.card_bill_period_end,
                t.created_at, t.updated_at,
                (SELECT it.installment_number FROM installment_transactions it
                  WHERE it.transaction_id = t.id
                  ORDER BY it.installment_number
                  LIMIT 1) AS installment_number,
                COALESCE(
                    bill_due_date_for_period(t.account_id, t.card_bill_period_end),
                    card_bill_due_date(t.account_id, t.date)
                ) AS card_due_date
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE ($1::uuid[] IS NULL OR t.category_id = ANY($1))
           AND ($2::text IS NULL OR t.type = $2)
           AND ($3::date IS NULL OR t.date >= $3 - INTERVAL '3 months')
           AND ($4::date IS NULL OR t.date <= $4)
           AND ($5::uuid IS NULL OR t.account_id = $5)
           AND ($3::date IS NULL OR effective_transaction_date(t.date, t.account_id, $8, t.card_bill_period_end) >= $3)
           AND ($4::date IS NULL OR effective_transaction_date(t.date, t.account_id, $8, t.card_bill_period_end) <= $4)
         ORDER BY {order_sql}
         LIMIT $6 OFFSET $7"
    );
    let items: Vec<Transaction> = sqlx::query_as(AssertSqlSafe(query))
        .bind(&category_ids)
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

/// Returns a category and all of its descendants for budget-aligned filtering.
async fn category_subtree_ids(pool: &PgPool, category_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "WITH RECURSIVE category_tree AS (
             SELECT id FROM categories WHERE id = $1
             UNION
             SELECT c.id
             FROM categories c JOIN category_tree parent ON c.parent_id = parent.id
         )
         SELECT id FROM category_tree",
    )
    .bind(category_id)
    .fetch_all(pool)
    .await
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

/// Splits `total` into `count` monthly installments.
pub(crate) fn installment_split(total: Decimal, count: i32) -> (Decimal, Decimal) {
    let per = (total / Decimal::from(count)).round_dp(2);
    let last = total - per * Decimal::from(count - 1);
    // Every installment but the last holds `per`, and the
    // last one absorbs the rounding remainder, so the parts always add up to
    // `total` (e.g. 100.00 over 3 => 33.33, 33.33, 33.34).
    (per, last)
}

/// Card-billing anchor of a plan: the cycle its first installment lands on.
#[derive(Clone, Copy, Default)]
pub(crate) struct PlanBilling {
    /// `(closing_day, due_day)` of the card the plan is charged to.
    pub card: Option<(i16, i16)>,
    /// Closing date of the bill the first installment belongs to.
    pub start_period_end: Option<NaiveDate>,
}

/// Creates the installment plan for `first` and materializes the remaining
/// installments as real, dated transactions.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_installment_plan(
    db: &mut PgConnection,
    first: &Transaction,
    count: i32,
    per: Decimal,
    last: Decimal,
    total: Decimal,
    category_id: Option<Uuid>,
    account_id: Uuid,
    posting_account: Uuid,
    posting_name: &str,
    source_name: &str,
    billing: PlanBilling,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let cycle = match (billing.card, billing.start_period_end) {
        (Some(card), Some(start)) => {
            let derived = credit_cards::cycle_for_date(card.0, card.1, first.date).1;
            Some((
                card,
                start,
                credit_cards::months_between_cycles(derived, start),
            ))
        }
        _ => None,
    };

    // The plan row (account_id is the resolved payment account).
    let plan_id: Uuid = sqlx::query_scalar(
        "INSERT INTO installment_plans
            (description, total_amount, installments, installment_amount, category_id, start_date,
             account_id, card_bill_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id",
    )
    .bind(&first.description)
    .bind(total)
    .bind(count)
    .bind(per)
    .bind(category_id)
    .bind(first.date)
    .bind(account_id)
    .bind(billing.start_period_end)
    .fetch_one(&mut *db)
    .await
    .map_err(|e| {
        error!("Failed to create installment plan: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create installment plan" })),
        )
    })?;

    // First installment is the transaction we were given.
    sqlx::query("UPDATE transactions SET installment_plan_id = $1 WHERE id = $2")
        .bind(plan_id)
        .bind(first.id)
        .execute(&mut *db)
        .await
        .map_err(|e| {
            error!("Failed to link installment plan: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to create installment plan" })),
            )
        })?;
    let first_due = match cycle {
        Some((_, _, months)) => transaction_ledger::add_months(first.date, months),
        None => first.date,
    };
    sqlx::query(
        "INSERT INTO installment_transactions (plan_id, installment_number, due_date, transaction_id, status)
         VALUES ($1, 1, $2, $3, 'generated')",
    )
    .bind(plan_id)
    .bind(first_due)
    .bind(first.id)
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
        // A pinned first bill shifts both the expense month and the bill cycle.
        let shift = cycle.map(|(_, _, months)| months).unwrap_or(0);
        let due = transaction_ledger::add_months(first.date, i - 1 + shift);
        let period_end =
            cycle.map(|(card, start, _)| credit_cards::shift_period_end(start, card.0, i - 1));
        let amount_i = if i == count { last } else { per };
        let desc_i = format!("Parcela {}/{} — {}", i, count, first.description);
        let t: Transaction = sqlx::query_as(
            "INSERT INTO transactions (description, amount, type, category_id, date, notes,
                                       installment_plan_id, account_id, card_bill_period_end)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, description, amount, type, category_id, date, notes,
                       installment_plan_id, account_id, card_bill_period_end, created_at, updated_at",
        )
        .bind(&desc_i)
        .bind(amount_i)
        .bind(&first.r#type)
        .bind(category_id)
        .bind(due)
        .bind(None::<String>)
        .bind(plan_id)
        .bind(account_id)
        .bind(period_end)
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
            posting_name,
            account_id,
            source_name,
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

        // Materialize the bill this installment is pinned to.
        if let (Some((card, _, _)), Some(period_end)) = (cycle, period_end) {
            credit_cards::ensure_bill_for_period(&mut *db, account_id, card.0, card.1, period_end)
                .await
                .map_err(|e| {
                    error!("Failed to upsert installment bill: {e}");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Failed to create installment plan" })),
                    )
                })?;
        }

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

    Ok(())
}

/// Billing anchor of an existing plan.
pub(crate) async fn plan_billing_of(
    pool: &PgPool,
    plan_id: Uuid,
) -> Result<PlanBilling, (StatusCode, Json<serde_json::Value>)> {
    #[derive(sqlx::FromRow)]
    struct PlanRow {
        start_date: NaiveDate,
        account_id: Option<Uuid>,
        card_bill_period_end: Option<NaiveDate>,
    }

    let row: Option<PlanRow> = sqlx::query_as(
        "SELECT start_date, account_id, card_bill_period_end
           FROM installment_plans WHERE id = $1",
    )
    .bind(plan_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("Failed to load installment plan {}: {e}", plan_id);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to load installment plan" })),
        )
    })?;

    let row = match row {
        Some(row) => row,
        None => return Ok(PlanBilling::default()),
    };

    let card = credit_cards::card_cycle(pool, row.account_id)
        .await
        .map_err(|e| {
            error!("Failed to load plan card cycle: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to load card cycle" })),
            )
        })?;
    let start_period_end = row.card_bill_period_end.or_else(|| {
        card.map(|(closing, due)| credit_cards::cycle_for_date(closing, due, row.start_date).1)
    });

    Ok(PlanBilling {
        card,
        start_period_end,
    })
}

/// 1-based installment position of a transaction inside its plan.
pub(crate) async fn installment_number_of(
    pool: &PgPool,
    transaction_id: Uuid,
) -> Result<Option<i32>, (StatusCode, Json<serde_json::Value>)> {
    sqlx::query_scalar(
        "SELECT installment_number FROM installment_transactions
          WHERE transaction_id = $1
          ORDER BY installment_number
          LIMIT 1",
    )
    .bind(transaction_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("Failed to load installment number: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to load installment" })),
        )
    })
}

/// Re-stamps the whole plan after its first bill moved.
pub(crate) async fn shift_plan_bills(
    conn: &mut PgConnection,
    plan_id: Uuid,
    card_id: Uuid,
    closing_day: i16,
    due_day: i16,
    old_start: NaiveDate,
    new_start: NaiveDate,
) -> Result<(), String> {
    let blocked: Option<i32> = sqlx::query_scalar(
        "SELECT installment_number FROM installment_transactions
          WHERE plan_id = $1 AND (status = 'paid' OR anticipated_at IS NOT NULL)
          ORDER BY installment_number
          LIMIT 1",
    )
    .bind(plan_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if let Some(number) = blocked {
        return Err(format!(
            "installment {number} is already paid or anticipated; undo it before moving the plan"
        ));
    }

    let months = credit_cards::months_between_cycles(old_start, new_start);

    #[derive(sqlx::FromRow)]
    struct InstallmentRow {
        installment_number: i32,
        due_date: NaiveDate,
        transaction_id: Option<Uuid>,
        card_bill_period_end: Option<NaiveDate>,
    }

    let rows: Vec<InstallmentRow> = sqlx::query_as(
        "SELECT it.installment_number, it.due_date, it.transaction_id,
                t.card_bill_period_end
           FROM installment_transactions it
           LEFT JOIN transactions t ON t.id = it.transaction_id
          WHERE it.plan_id = $1
          ORDER BY it.installment_number",
    )
    .bind(plan_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    for row in rows {
        let period_end =
            credit_cards::shift_period_end(new_start, closing_day, row.installment_number - 1);

        if let Some(current) = row.card_bill_period_end {
            if current != period_end
                && credit_cards::period_is_paid(&mut *conn, card_id, current)
                    .await
                    .map_err(|e| e.to_string())?
            {
                return Err(format!("the bill closing {current} is already paid"));
            }
        }
        if credit_cards::period_is_paid(&mut *conn, card_id, period_end)
            .await
            .map_err(|e| e.to_string())?
        {
            return Err(format!("the bill closing {period_end} is already paid"));
        }

        credit_cards::ensure_bill_for_period(&mut *conn, card_id, closing_day, due_day, period_end)
            .await
            .map_err(|e| e.to_string())?;

        if let Some(transaction_id) = row.transaction_id {
            sqlx::query(
                "UPDATE transactions SET card_bill_period_end = $1, updated_at = NOW() WHERE id = $2",
            )
            .bind(period_end)
            .bind(transaction_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        }

        let shifted_due = transaction_ledger::add_months(row.due_date, months);
        sqlx::query(
            "UPDATE installment_transactions SET due_date = $1
              WHERE plan_id = $2 AND installment_number = $3",
        )
        .bind(shifted_due)
        .bind(plan_id)
        .bind(row.installment_number)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    sqlx::query("UPDATE installment_plans SET card_bill_period_end = $1 WHERE id = $2")
        .bind(new_start)
        .bind(plan_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
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
            let (per, last) = installment_split(payload.amount, count);
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

    let card = credit_cards::card_cycle(&state.pg_pool, payload.account_id)
        .await
        .map_err(|e| {
            error!("Failed to load card cycle: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to load card cycle" })),
            )
        })?;
    let bill_period_end = credit_cards::resolve_bill_period_end(
        &state.pg_pool,
        payload.account_id,
        payload.date,
        payload.card_bill_period_end,
        None,
    )
    .await
    .map_err(|e| (e.status(), Json(json!({ "error": e.message() }))))?;
    // A plan always anchors on a cycle: the pinned one, or the derived cycle.
    let plan_billing = PlanBilling {
        card,
        start_period_end: bill_period_end.or_else(|| {
            card.map(|(closing, due)| credit_cards::cycle_for_date(closing, due, payload.date).1)
        }),
    };

    let mut db = state.pg_pool.begin().await.map_err(|e| {
        error!("Failed to begin DB transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to begin transaction" })),
        )
    })?;

    let transaction = sqlx::query_as::<_, Transaction>(
        "INSERT INTO transactions (description, amount, type, category_id, date, notes,
                                   installment_plan_id, account_id, card_bill_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, description, amount, type, category_id, date, notes,
                   installment_plan_id, account_id, card_bill_period_end, created_at, updated_at",
    )
    .bind(payload.description.trim())
    .bind(first_amount)
    .bind(&payload.r#type)
    .bind(payload.category_id)
    .bind(payload.date)
    .bind(&payload.notes)
    .bind(payload.installment_plan_id)
    .bind(source_account)
    .bind(bill_period_end)
    .fetch_one(&mut *db)
    .await
    .map_err(|e| {
        error!("Failed to create transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create transaction" })),
        )
    })?;

    // Post the balanced ledger pair.
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

    // Materialize the pinned bill so the card pages can list it right away.
    if let (Some(period_end), Some((closing, due))) = (bill_period_end, card) {
        credit_cards::ensure_bill_for_period(&mut db, source_account, closing, due, period_end)
            .await
            .map_err(|e| {
                error!("Failed to upsert card bill: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to attach transaction to bill" })),
                )
            })?;
    }

    // When splitting into installments, create the plan and materialize every
    // installment as a dated expense. On a cash basis each counts in its due month.
    if let Some((count, per, last)) = installment_spec {
        create_installment_plan(
            &mut db,
            &transaction,
            count,
            per,
            last,
            payload.amount,
            payload.category_id,
            source_account,
            posting_account,
            &posting_name,
            &source_name,
            plan_billing,
        )
        .await?;
    }

    // Reload the first transaction so the response reflects the linked plan.
    let transaction = if installment_spec.is_some() {
        sqlx::query_as::<_, Transaction>(
            "SELECT t.id, t.description, t.amount, t.type, t.category_id, t.date, t.notes,
                    t.installment_plan_id, t.account_id, t.card_bill_period_end,
                    t.created_at, t.updated_at,
                    COALESCE(
                        bill_due_date_for_period(t.account_id, t.card_bill_period_end),
                        card_bill_due_date(t.account_id, t.date)
                    ) AS card_due_date
             FROM transactions t WHERE t.id = $1",
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
        "SELECT t.id, t.description, t.amount, t.type, t.category_id, t.date, t.notes,
                t.installment_plan_id, t.account_id, t.card_bill_period_end,
                t.created_at, t.updated_at,
                (SELECT it.installment_number FROM installment_transactions it
                  WHERE it.transaction_id = t.id
                  ORDER BY it.installment_number
                  LIMIT 1) AS installment_number,
                COALESCE(
                    bill_due_date_for_period(t.account_id, t.card_bill_period_end),
                    card_bill_due_date(t.account_id, t.date)
                ) AS card_due_date
         FROM transactions t
         WHERE t.id = $1",
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

    let installment_spec = match payload.installments {
        Some(n) if !(2..=60).contains(&n) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "installments must be between 2 and 60" })),
            ));
        }
        Some(n) => {
            let count = n as i32;
            let (per, last) = installment_split(payload.amount, count);
            Some((count, per, last))
        }
        None => None,
    };

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

    // Capture the existing ledger group id (so stale entries can be removed)
    // and the current plan link (so a split cannot duplicate a plan).
    #[derive(sqlx::FromRow)]
    struct Existing {
        ledger_transaction_id: Option<Uuid>,
        installment_plan_id: Option<Uuid>,
        account_id: Option<Uuid>,
        date: NaiveDate,
        card_bill_period_end: Option<NaiveDate>,
    }

    let existing: Option<Existing> = sqlx::query_as(
        "SELECT ledger_transaction_id, installment_plan_id, account_id, date, card_bill_period_end
         FROM transactions WHERE id = $1",
    )
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

    let existing = match existing {
        Some(v) => v,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Transaction not found" })),
            ))
        }
    };
    let old_ledger_id = existing.ledger_transaction_id;

    if installment_spec.is_some() && existing.installment_plan_id.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "transaction already belongs to an installment plan" })),
        ));
    }

    // Card billing: an explicit cycle from the payload, or nothing.
    let card = credit_cards::card_cycle(&state.pg_pool, payload.account_id)
        .await
        .map_err(|e| {
            error!("Failed to load card cycle: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to load card cycle" })),
            )
        })?;

    let current_cycle = match existing.installment_plan_id {
        Some(plan_id) => {
            plan_billing_of(&state.pg_pool, plan_id)
                .await?
                .start_period_end
        }
        None => match existing.card_bill_period_end {
            Some(period_end) => Some(period_end),
            None => {
                credit_cards::derived_period_end(&state.pg_pool, existing.account_id, existing.date)
                    .await
                    .map_err(|e| {
                        error!("Failed to derive bill cycle: {e}");
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to derive bill cycle" })),
                        )
                    })?
            }
        },
    };

    if payload.card_bill_period_end.is_some()
        && payload.card_bill_period_end != existing.card_bill_period_end
        && existing.installment_plan_id.is_some()
        && installment_number_of(&state.pg_pool, id).await? != Some(1)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "move the first installment to change the bill of an installment plan"
            })),
        ));
    }

    let requested_period_end = credit_cards::resolve_bill_period_end(
        &state.pg_pool,
        payload.account_id,
        payload.date,
        payload.card_bill_period_end,
        current_cycle,
    )
    .await
    .map_err(|e| (e.status(), Json(json!({ "error": e.message() }))))?;

    // A plan keeps its anchor unless the caller proves a plan move: never
    // silently unpin it by omitting the field.
    let bill_period_end = match requested_period_end {
        Some(period_end) => Some(period_end),
        None if existing.installment_plan_id.is_some() => existing.card_bill_period_end,
        None => None,
    };

    // Plan billing: the anchor the plan had before this edit (needed to shift
    // the remaining installments when the first bill moves).
    let plan_billing = match existing.installment_plan_id {
        Some(plan_id) => Some(plan_billing_of(&state.pg_pool, plan_id).await?),
        None => None,
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
             date = $5, notes = $6, installment_plan_id = $7, account_id = $8,
             card_bill_period_end = $9, updated_at = NOW()
         WHERE id = $10
         RETURNING id, description, amount, type, category_id, date, notes,
                   installment_plan_id, account_id, card_bill_period_end, created_at, updated_at",
    )
    .bind(payload.description.trim())
    // A split stores the installment amount on this row; otherwise the amount.
    .bind(first_amount)
    .bind(&payload.r#type)
    .bind(payload.category_id)
    .bind(payload.date)
    .bind(&payload.notes)
    .bind(payload.installment_plan_id)
    .bind(source_account)
    .bind(bill_period_end)
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

    if let (Some(billing), Some(new_start)) = (plan_billing, bill_period_end) {
        // Prefer the account's current cycle (the card may have been re-picked).
        let cycle = card.or(billing.card);
        if let (Some((closing, due)), Some(old_start)) = (cycle, billing.start_period_end) {
            if old_start != new_start {
                shift_plan_bills(
                    &mut db,
                    existing
                        .installment_plan_id
                        .expect("plan billing implies a plan"),
                    source_account,
                    closing,
                    due,
                    old_start,
                    new_start,
                )
                .await
                .map_err(|message| (StatusCode::CONFLICT, Json(json!({ "error": message }))))?;
            }
        }
    } else if let (Some(period_end), Some((closing, due))) = (bill_period_end, card) {
        credit_cards::ensure_bill_for_period(&mut db, source_account, closing, due, period_end)
            .await
            .map_err(|e| {
                error!("Failed to upsert card bill: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to attach transaction to bill" })),
                )
            })?;
    }

    // A split on edit creates the plan now that the row holds `per`.
    if let Some((count, per, last)) = installment_spec {
        create_installment_plan(
            &mut db,
            &transaction,
            count,
            per,
            last,
            payload.amount,
            payload.category_id,
            source_account,
            posting_account,
            &posting_name,
            &source_name,
            PlanBilling {
                card,
                start_period_end: bill_period_end.or_else(|| {
                    card.map(|(closing, due)| {
                        credit_cards::cycle_for_date(closing, due, payload.date).1
                    })
                }),
            },
        )
        .await?;
    }

    // Reload so the response reflects the linked plan.
    let transaction = if installment_spec.is_some() {
        sqlx::query_as::<_, Transaction>(
            "SELECT t.id, t.description, t.amount, t.type, t.category_id, t.date, t.notes,
                    t.installment_plan_id, t.account_id, t.card_bill_period_end,
                    t.created_at, t.updated_at,
                    COALESCE(
                        bill_due_date_for_period(t.account_id, t.card_bill_period_end),
                        card_bill_due_date(t.account_id, t.date)
                    ) AS card_due_date
             FROM transactions t WHERE t.id = $1",
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

#[cfg(test)]
mod tests {
    use super::installment_split;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).expect("literal is a valid decimal")
    }

    #[test]
    fn split_divides_evenly_without_a_remainder() {
        let (per, last) = installment_split(dec("120.00"), 3);
        assert_eq!(per, dec("40.00"));
        assert_eq!(last, dec("40.00"));
    }

    #[test]
    fn split_gives_the_rounding_remainder_to_the_last_installment() {
        // 100.00 / 3 = 33.333...; the first two are rounded down and the last
        // one carries the cent that keeps the plan adding up to the total.
        let (per, last) = installment_split(dec("100.00"), 3);
        assert_eq!(per, dec("33.33"));
        assert_eq!(last, dec("33.34"));
    }

    #[test]
    fn split_parts_always_add_up_to_the_total() {
        for (total, count) in [
            ("100.00", 3),
            ("100.01", 7),
            ("1234.56", 60),
            ("10.00", 4),
            ("0.03", 2),
        ] {
            let total = dec(total);
            let count: i32 = count;
            let (per, last) = installment_split(total, count);
            assert_eq!(
                per * Decimal::from(count - 1) + last,
                total,
                "{total} split over {count} installments must add up"
            );
        }
    }
}
