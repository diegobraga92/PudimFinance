//! Posts balanced ledger entries for simple transactions.
//!
//! By convention `ledger_entries.transaction_id = transactions.id`. Legacy rows
//! may use `transactions.ledger_transaction_id` instead, and `delete_entries`
//! handles both forms.

use anyhow::{anyhow, Result};
use rust_decimal::Decimal;
use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

/// Posting plan for a transaction, as `(posting_debit, posting_credit,
/// source_debit, source_credit)`.
///
/// * For `expense`, debit the expense (posting) account and credit the source account.
/// * For `income`, debit the source account and credit the income (posting) account.
///
/// The two entries always balance (debits == credits == `amount`).
fn legs(ttype: &str, amount: Decimal) -> Option<(Decimal, Decimal, Decimal, Decimal)> {
    match ttype {
        "expense" => Some((amount, Decimal::ZERO, Decimal::ZERO, amount)),
        "income" => Some((Decimal::ZERO, amount, amount, Decimal::ZERO)),
        _ => None,
    }
}

/// Resolves the account that receives/emits the transaction value (the
/// income/expense side), in this priority order.
///
/// 1. The category's explicit `ledger_account_id`.
/// 2. An existing account whose name/type match the category.
/// 3. A posting account created on the fly for the category (and linked).
/// 4. A generic posting account ("Other Income" / "Miscellaneous").
/// 5. Any account of the required type.
pub async fn resolve_posting_account(
    pool: &PgPool,
    category_id: Option<Uuid>,
    ttype: &str,
) -> Result<Uuid> {
    if let Some(cid) = category_id {
        // 1. Explicit category link.
        // `ledger_account_id` is nullable. `fetch_optional` already wraps
        // the scalar in `Option<T>`, so the scalar type must be `Option<Uuid>`
        // here. Otherwise a NULL column fails to decode ("unexpected null").
        let linked: Option<Uuid> = sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT ledger_account_id FROM categories WHERE id = $1",
        )
        .bind(cid)
        .fetch_optional(pool)
        .await?
        .flatten();
        if let Some(id) = linked {
            return Ok(id);
        }

        // 2. Existing account matching the category name.
        let by_name: Option<Uuid> = sqlx::query_scalar(
            "SELECT a.id
             FROM accounts a
             JOIN categories c ON c.id = $1
             WHERE a.type = $2 AND a.name = c.name
             LIMIT 1",
        )
        .bind(cid)
        .bind(ttype)
        .fetch_optional(pool)
        .await?;
        if let Some(id) = by_name {
            sqlx::query("UPDATE categories SET ledger_account_id = $1 WHERE id = $2")
                .bind(id)
                .bind(cid)
                .execute(pool)
                .await?;
            return Ok(id);
        }

        // 3. Create and link a posting account for this category.
        //
        // `fetch_optional` on purpose: an id the server does not know selects no
        // rows, and a client can legitimately reference a category that is gone
        // (deleted here, or restored from another database). That must fall
        // through to the generic posting account below instead of failing the
        // whole write with `RowNotFound`.
        let created: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO accounts (name, type)
             SELECT c.name, $2 FROM categories c WHERE c.id = $1
             RETURNING id",
        )
        .bind(cid)
        .bind(ttype)
        .fetch_optional(pool)
        .await?;
        if let Some(created) = created {
            sqlx::query("UPDATE categories SET ledger_account_id = $1 WHERE id = $2")
                .bind(created)
                .bind(cid)
                .execute(pool)
                .await?;
            return Ok(created);
        }
    }

    // 4. With no category, fall back to a generic posting account.
    let fallback = if ttype == "income" {
        "Other Income"
    } else {
        "Miscellaneous"
    };
    let generic: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM accounts WHERE type = $1 AND name = $2 LIMIT 1")
            .bind(ttype)
            .bind(fallback)
            .fetch_optional(pool)
            .await?;
    if let Some(id) = generic {
        return Ok(id);
    }

    // 5. Any account of the required type.
    let any: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM accounts WHERE type = $1 ORDER BY created_at LIMIT 1")
            .bind(ttype)
            .fetch_optional(pool)
            .await?;

    match any {
        Some(id) => Ok(id),
        None => Err(anyhow!(
            "no {ttype} ledger account exists — create an account on the Accounts page first"
        )),
    }
}

/// Resolves the source (payment) account for a transaction. Validates that an
/// explicitly provided account is an asset or liability, then falls back
/// to Cash, then Bank Account, then the oldest asset account.
pub async fn resolve_source_account(pool: &PgPool, account_id: Option<Uuid>) -> Result<Uuid> {
    if let Some(id) = account_id {
        let t: Option<String> = sqlx::query_scalar("SELECT type FROM accounts WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
        return match t.as_deref() {
            Some("asset") | Some("liability") => Ok(id),
            Some(_) => Err(anyhow!(
                "account_id must reference an asset or liability account"
            )),
            None => Err(anyhow!("account_id does not reference an existing account")),
        };
    }

    for name in ["Cash", "Bank Account"] {
        let id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM accounts WHERE type = 'asset' AND name = $1 LIMIT 1",
        )
        .bind(name)
        .fetch_optional(pool)
        .await?;
        if let Some(id) = id {
            return Ok(id);
        }
    }

    let any: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM accounts WHERE type = 'asset' ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    match any {
        Some(id) => Ok(id),
        None => Err(anyhow!(
            "no asset account exists — create an account on the Accounts page first"
        )),
    }
}

/// Fetches the display name of an account.
pub async fn account_name(pool: &PgPool, id: Uuid) -> Result<String> {
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM accounts WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    name.ok_or_else(|| anyhow!("account {id} no longer exists"))
}

/// Validates a client-supplied category id against the categories this database
/// actually has.
///
/// Returns the id unchanged when it exists, otherwise `None` plus a
/// user-facing warning. Clients legitimately hold ids the server does not know
/// (the category was deleted here, or the app was pointed at another server /
/// restored database), and such a reference must downgrade the write to
/// "uncategorized" instead of failing it — the transaction row references
/// `categories(id)` by foreign key, so an unknown id would be rejected outright.
pub async fn sanitize_category_id(
    pool: &PgPool,
    category_id: Option<Uuid>,
) -> Result<(Option<Uuid>, Option<String>)> {
    let Some(id) = category_id else {
        return Ok((None, None));
    };
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM categories WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(match existing {
        Some(id) => (Some(id), None),
        None => (
            None,
            Some(format!(
                "category {id} no longer exists; the transaction was saved without a category"
            )),
        ),
    })
}

/// Inserts the balanced ledger pair for a simple transaction, using
/// `simple_tx_id` as the ledger group id.
///
/// The executor is consumed by value and used exactly once, so it can be a
/// connection, a `&mut sqlx::Transaction`, or a pool.
#[allow(clippy::too_many_arguments)]
pub async fn post_entries<'e, E>(
    executor: E,
    simple_tx_id: Uuid,
    ttype: &str,
    posting_account: Uuid,
    posting_name: &str,
    source_account: Uuid,
    source_name: &str,
    amount: Decimal,
    description: &str,
) -> Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    let (pd, pc, sd, sc) =
        legs(ttype, amount).ok_or_else(|| anyhow!("invalid transaction type '{ttype}'"))?;

    sqlx::query(
        "INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
         VALUES ($1, $2, $3, $4, $5), ($1, $6, $7, $8, $9)",
    )
    .bind(simple_tx_id)
    .bind(posting_account)
    .bind(pd)
    .bind(pc)
    .bind(format!("{description} ({posting_name})"))
    .bind(source_account)
    .bind(sd)
    .bind(sc)
    .bind(format!("{description} ({source_name})"))
    .execute(executor)
    .await?;

    Ok(())
}

/// Removes the ledger entries belonging to a simple transaction. Handles both
/// the current convention (`transaction_id = transactions.id`) and the legacy
/// one (`transaction_id = transactions.ledger_transaction_id`).
pub async fn delete_entries<'e, E>(executor: E, simple_tx_id: Uuid, ledger_tx_id: Option<Uuid>)
where
    E: Executor<'e, Database = Postgres>,
{
    let _ =
        sqlx::query("DELETE FROM ledger_entries WHERE transaction_id = $1 OR transaction_id = $2")
            .bind(simple_tx_id)
            .bind(ledger_tx_id)
            .execute(executor)
            .await;
}

/// Adds `months` to a date, clamping the day to the last valid day of the
/// target month (for example Jan 31 plus one month becomes Feb 28).
pub fn add_months(d: chrono::NaiveDate, months: i32) -> chrono::NaiveDate {
    use chrono::Datelike;
    let total = d.year() * 12 + (d.month0() as i32) + months;
    let year = total.div_euclid(12);
    let month0 = total.rem_euclid(12);
    let month = month0 + 1;
    let day = d.day();
    let first_of_month = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1);
    let max_day = match first_of_month {
        Some(_) => {
            if month == 12 {
                31
            } else {
                chrono::NaiveDate::from_ymd_opt(year, (month + 1) as u32, 1)
                    .expect("first of next month always valid")
                    .pred_opt()
                    .expect("month has a predecessor")
                    .day()
            }
        }
        None => 28,
    };
    chrono::NaiveDate::from_ymd_opt(year, month as u32, day.min(max_day))
        .expect("clamped day is always valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    #[test]
    fn expense_legs_debit_posting_credit_source() {
        let amount = dec("150.50");
        let (pd, pc, sd, sc) = legs("expense", amount).expect("expense is valid");
        // Debits == credits == amount.
        assert_eq!(pd + sd, amount);
        assert_eq!(pc + sc, amount);
        // Posting side is debited, source side is credited.
        assert_eq!(pd, amount);
        assert_eq!(sc, amount);
        assert_eq!(pc, Decimal::ZERO);
        assert_eq!(sd, Decimal::ZERO);
        // The pair is balanced and each entry is one-sided.
        assert!(crate::ledger::validate_balance(&[pd, sd], &[pc, sc]).is_ok());
    }

    #[test]
    fn income_legs_debit_source_credit_posting() {
        let amount = dec("3000.00");
        let (pd, pc, sd, sc) = legs("income", amount).expect("income is valid");
        assert_eq!(pd + sd, amount);
        assert_eq!(pc + sc, amount);
        // Source side is debited, posting side is credited.
        assert_eq!(sd, amount);
        assert_eq!(pc, amount);
        assert_eq!(pd, Decimal::ZERO);
        assert_eq!(sc, Decimal::ZERO);
        assert!(crate::ledger::validate_balance(&[pd, sd], &[pc, sc]).is_ok());
    }

    #[test]
    fn add_months_clamps_day_to_month_length() {
        use chrono::NaiveDate;
        let jan31 = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        // One month after Jan 31 clamps to Feb 28 (2026 is not a leap year).
        assert_eq!(
            add_months(jan31, 1),
            NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
        );
        // Year boundary.
        assert_eq!(
            add_months(jan31, 12),
            NaiveDate::from_ymd_opt(2027, 1, 31).unwrap()
        );
        // Plain mid-month stays exact.
        let mar15 = NaiveDate::from_ymd_opt(2026, 3, 15).unwrap();
        assert_eq!(
            add_months(mar15, 3),
            NaiveDate::from_ymd_opt(2026, 6, 15).unwrap()
        );
    }

    #[test]
    fn invalid_type_has_no_plan() {
        assert!(legs("transfer", dec("10")).is_none());
    }

    /// Opens the configured database, or `None` when the suite runs without one
    /// (the unit tests above must stay runnable without `DATABASE_URL`).
    async fn test_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPool::connect(&url).await.ok()
    }

    /// A category id this database does not have must downgrade the write to
    /// "uncategorized" with a warning instead of failing it.
    #[tokio::test]
    async fn sanitize_category_id_reports_an_unknown_id() {
        let Some(pool) = test_pool().await else {
            return;
        };

        let (sanitized, warning) = sanitize_category_id(&pool, Some(Uuid::new_v4()))
            .await
            .expect("an unknown id must not fail sanitisation");
        assert_eq!(sanitized, None);
        assert!(warning.is_some(), "an unknown id must report a warning");

        let (sanitized, warning) = sanitize_category_id(&pool, None).await.expect("sanitize");
        assert_eq!(sanitized, None);
        assert!(warning.is_none(), "no category at all stays silent");

        let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM categories LIMIT 1")
            .fetch_optional(&pool)
            .await
            .expect("query categories");
        if let Some(id) = existing {
            let (sanitized, warning) = sanitize_category_id(&pool, Some(id))
                .await
                .expect("sanitize");
            assert_eq!(sanitized, Some(id), "a known category is passed through");
            assert!(warning.is_none());
        }
    }

    /// The real-world bug: a stale category id made `resolve_posting_account`
    /// fail with `RowNotFound`, which rejected every capture while the app
    /// showed nothing. It must fall through to the generic posting account.
    #[tokio::test]
    async fn resolve_posting_account_falls_back_for_an_unknown_category() {
        let Some(pool) = test_pool().await else {
            return;
        };

        match resolve_posting_account(&pool, Some(Uuid::new_v4()), "expense").await {
            Ok(_) => {}
            // A database with no expense account at all is the only legitimate
            // failure, and it must say so instead of surfacing a row-not-found.
            Err(error) => {
                let message = error.to_string();
                assert!(
                    message.contains("ledger account exists"),
                    "an unknown category must fall back, got: {message}"
                );
            }
        }
    }
}
