use axum::Json;
use serde::Serialize;
use tracing::info;
use utoipa::ToSchema;

use crate::db;
use crate::metrics;
use crate::state::AppState;

/// Successful health check payload returned with HTTP 200.
#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    /// Overall service status (e.g., `"ok"`).
    pub status: String,
    /// Database connection state (e.g., `"connected"`).
    pub database: String,
    /// RabbitMQ connection state (e.g., `"disabled"`).
    pub rabbitmq: String,
    /// Backend crate version from `CARGO_PKG_VERSION`.
    pub version: String,
}

/// Failed health check payload returned with HTTP 503.
#[derive(Debug, Serialize, ToSchema)]
pub struct HealthError {
    /// Overall service status (e.g., `"unhealthy"`).
    pub status: String,
    /// Database connection state (e.g., `"disconnected"`).
    pub database: String,
    /// RabbitMQ connection state (e.g., `"unknown"`).
    pub rabbitmq: String,
    /// Human-readable explanation of the failure.
    pub details: String,
}

/// Returns the health status of the backend and its dependencies
/// (PostgreSQL, RabbitMQ). Returns 200 if healthy, 503 if degraded.
#[utoipa::path(
    get,
    path = "/health",
    tag = "Health",
    responses(
        (status = 200, description = "Service is healthy", body = HealthResponse),
        (status = 503, description = "Service is degraded or unavailable", body = HealthError),
    ),
)]
pub async fn health_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<HealthResponse>, (axum::http::StatusCode, Json<HealthError>)> {
    let db_healthy = db::check_db_health(&state.pg_pool).await;
    let rabbitmq_healthy = state.event_publisher.is_healthy().await;
    metrics::set_rabbitmq_connected(rabbitmq_healthy);

    if !db_healthy {
        info!("Health check failed: database unreachable");
        return Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthError {
                status: "unhealthy".into(),
                database: "disconnected".into(),
                rabbitmq: if rabbitmq_healthy {
                    "connected".into()
                } else {
                    "unavailable".into()
                },
                details: "PostgreSQL connection failed".into(),
            }),
        ));
    }

    // RabbitMQ is optional, so report its state without failing the health check.
    Ok(Json(HealthResponse {
        status: "ok".into(),
        database: "connected".into(),
        rabbitmq: if rabbitmq_healthy {
            "connected".into()
        } else {
            "connecting".into()
        },
        version: env!("CARGO_PKG_VERSION").into(),
    }))
}

/// Documents the Prometheus `/metrics` endpoint for the OpenAPI spec.
///
/// Stub only. The live endpoint is served by the main router.
#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/metrics",
    tag = "Health",
    responses(
        (status = 200, description = "Prometheus metrics in text format", content_type = "text/plain"),
    ),
)]
pub fn metrics_handler_doc() -> &'static str {
    ""
}
