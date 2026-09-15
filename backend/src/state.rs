use sqlx::PgPool;
use std::sync::Arc;

use crate::events::EventPublisher;
use crate::google::GoogleVerifier;
use crate::middleware::RateLimiterState;

/// Shared application state injected into axum handlers via [`axum::extract::State`].
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool shared across all request handlers.
    pub pg_pool: PgPool,
    /// RabbitMQ event publisher for ledger events.
    pub event_publisher: EventPublisher,
    /// JWT secret used to sign access/refresh tokens.
    pub jwt_secret: String,
    /// Shared in-memory rate limiter state.
    pub rate_limiter: RateLimiterState,
    /// Google OAuth verifier, when Google sign-in is configured.
    pub google: Option<Arc<GoogleVerifier>>,
}
