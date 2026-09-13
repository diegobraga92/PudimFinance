pub mod accounts;
pub mod audit;
pub mod auth;
pub mod budgets;
pub mod categories;
pub mod credit_cards;
pub mod installments;
pub mod ledger;
pub mod receipts;
pub mod reports;
pub mod summary;
pub mod sync;
pub mod transactions;

use axum::Router;

use crate::state::AppState;

/// Builds the `/api` sub-router
pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(categories::router())
        .merge(credit_cards::router())
        .merge(transactions::router())
        .merge(summary::router())
        .merge(budgets::router())
        .merge(reports::router())
        .merge(ledger::router())
        .merge(accounts::router())
        .merge(auth::router())
        .merge(audit::router())
        .merge(receipts::router())
        .merge(installments::router())
        .merge(sync::router())
}
