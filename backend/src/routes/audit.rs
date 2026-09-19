//! Search over the immutable audit event log.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::json;
use serde_json::value::Value;
use tracing::error;

use crate::state::AppState;

/// Audit-event filters.
#[derive(Default, Deserialize)]
pub struct AuditQuery {
    /// Event type filter (e.g., `TransactionRecorded`).
    pub event_type: Option<String>,
    /// Aggregate ID filter (e.g., a transaction UUID).
    pub aggregate_id: Option<String>,
    /// Start date (inclusive).
    pub start_date: Option<NaiveDate>,
    /// End date (inclusive).
    pub end_date: Option<NaiveDate>,
    /// Page offset (default 0).
    pub page: Option<u32>,
    /// Page size (default 50, max 200).
    pub page_size: Option<u32>,
}

/// An audit event row.
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct AuditEvent {
    /// Sequence ID.
    pub id: i64,
    /// Aggregate ID (e.g., transaction UUID).
    pub aggregate_id: uuid::Uuid,
    /// Aggregate type.
    pub aggregate_type: String,
    /// Event type.
    pub event_type: String,
    /// Full event payload.
    pub payload: Value,
    /// Event timestamp.
    pub occurred_at: DateTime<Utc>,
}

/// Routes for audit-event searches.
pub fn router() -> Router<AppState> {
    Router::new().route("/api/audit/events", axum::routing::get(list_audit_events))
}

/// Lists audit events for any signed-in user.
///
/// Every authenticated account can read the trail; authentication itself is
/// enforced by the auth middleware on the API router.
#[utoipa::path(
    get,
    path = "/api/audit/events",
    tag = "Audit",
    responses(
        (status = 200, description = "List of audit events"),
        (status = 401, description = "Missing or invalid token"),
    ),
)]
pub async fn list_audit_events(
    State(state): State<AppState>,
    Query(params): Query<AuditQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let page_size = params.page_size.unwrap_or(50).clamp(1, 200);
    let page = params.page.unwrap_or(0);
    let offset = page.saturating_mul(page_size);

    let events: Vec<AuditEvent> = sqlx::query_as(
        "SELECT id, aggregate_id, aggregate_type, event_type, payload, occurred_at
         FROM events
         ORDER BY occurred_at DESC
         LIMIT $1 OFFSET $2",
    )
    .bind(page_size as i64)
    .bind(offset as i64)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch audit events: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch audit events" })),
        )
    })?;

    // Filters are applied after the bounded query.
    let filtered: Vec<AuditEvent> = events
        .into_iter()
        .filter(|e| {
            params
                .event_type
                .as_ref()
                .map(|et| e.event_type == *et)
                .unwrap_or(true)
        })
        .filter(|e| {
            params
                .aggregate_id
                .as_ref()
                .map(|ag| e.aggregate_id.to_string() == *ag)
                .unwrap_or(true)
        })
        .filter(|e| {
            params
                .start_date
                .map(|sd| e.occurred_at.date_naive() >= sd)
                .unwrap_or(true)
        })
        .filter(|e| {
            params
                .end_date
                .map(|ed| e.occurred_at.date_naive() <= ed)
                .unwrap_or(true)
        })
        .collect();

    Ok(Json(json!({
        "items": filtered,
        "page": page,
        "page_size": page_size,
    })))
}
