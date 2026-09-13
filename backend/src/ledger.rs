//! Double-entry ledger engine.
//!
//! Balanced transaction validation and account mapping. Pure domain logic with
//! no HTTP concerns.

use anyhow::{anyhow, Result};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Validates that a set of ledger entries is balanced (sum(debits) == sum(credits))
/// and that each entry has exactly one non-zero side.
pub fn validate_balance(debits: &[Decimal], credits: &[Decimal]) -> Result<()> {
    if debits.len() != credits.len() {
        return Err(anyhow!("Debit/credit arrays must have equal length"));
    }

    let total_debits: Decimal = debits.iter().sum();
    let total_credits: Decimal = credits.iter().sum();

    if total_debits != total_credits {
        return Err(anyhow!(
            "Unbalanced ledger transaction: debits ({}) != credits ({})",
            total_debits,
            total_credits
        ));
    }

    for (d, c) in debits.iter().zip(credits.iter()) {
        let d_positive = *d > Decimal::ZERO;
        let c_positive = *c > Decimal::ZERO;

        if d_positive == c_positive {
            return Err(anyhow!(
                "Each entry must have exactly one non-zero side (debit or credit)"
            ));
        }
    }

    Ok(())
}

/// Account lookup structure for mapping categories to accounts.
pub struct AccountMap {
    /// Name -> (id, type)
    pub by_name: std::collections::HashMap<String, (Uuid, String)>,
}

impl AccountMap {
    /// Loads all accounts from the DB.
    pub async fn load(pool: &PgPool) -> Result<Self> {
        #[derive(sqlx::FromRow)]
        struct Row {
            id: Uuid,
            name: String,
            r#type: String,
        }

        let rows: Vec<Row> = sqlx::query_as("SELECT id, name, type FROM accounts")
            .fetch_all(pool)
            .await?;

        let by_name = rows
            .into_iter()
            .map(|r| (r.name, (r.id, r.r#type)))
            .collect();

        Ok(Self { by_name })
    }

    /// Gets the asset account used as the "other side" of simple transactions.
    pub fn cash_account(&self) -> Option<(Uuid, String)> {
        self.by_name.get("Cash").cloned()
    }

    /// Resolves an account by exact name.
    pub fn get(&self, name: &str) -> Option<(Uuid, String)> {
        self.by_name.get(name).cloned()
    }
}
