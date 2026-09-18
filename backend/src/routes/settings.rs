//! Application settings used by reporting queries.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use sqlx::PgPool;
use tracing::error;

use crate::models::{AppSettings, UpdateAppSettingsRequest};
use crate::state::AppState;

/// Dating convention used when the settings row is missing.
pub const DEFAULT_CARD_EXPENSE_DATING: &str = "purchase_date";

/// `purchase_date`: a card purchase counts in the month it was made.
pub const DATING_PURCHASE: &str = "purchase_date";
/// `due_date`: a card purchase counts in the month its bill is due.
pub const DATING_DUE: &str = "due_date";

/// Routes for application settings.
pub fn router() -> Router<AppState> {
    Router::new().route("/api/settings", get(get_settings).put(update_settings))
}

/// Reads the card-expense dating preference, falling back to the default when
/// the settings row cannot be read.
pub async fn card_expense_dating(pool: &PgPool) -> String {
    let value: Option<String> =
        sqlx::query_scalar("SELECT card_expense_dating FROM app_settings WHERE id = TRUE")
            .fetch_optional(pool)
            .await
            .unwrap_or_else(|e| {
                error!("Failed to read app settings: {e}");
                None
            });

    value.unwrap_or_else(|| DEFAULT_CARD_EXPENSE_DATING.to_string())
}

/// Validates a dating preference value.
fn is_valid_dating(value: &str) -> bool {
    value == DATING_PURCHASE || value == DATING_DUE
}

/// Returns the current application settings.
#[utoipa::path(
    get,
    path = "/api/settings",
    tag = "Settings",
    responses(
        (status = 200, description = "Current settings", body = AppSettings),
    ),
)]
pub async fn get_settings(
    State(state): State<AppState>,
) -> Result<Json<AppSettings>, (StatusCode, Json<serde_json::Value>)> {
    let card_expense_dating = card_expense_dating(&state.pg_pool).await;
    Ok(Json(AppSettings {
        card_expense_dating,
    }))
}

/// Updates the application settings and returns the stored values.
#[utoipa::path(
    put,
    path = "/api/settings",
    tag = "Settings",
    request_body = UpdateAppSettingsRequest,
    responses(
        (status = 200, description = "Updated settings", body = AppSettings),
        (status = 400, description = "Invalid setting value"),
    ),
)]
pub async fn update_settings(
    State(state): State<AppState>,
    Json(payload): Json<UpdateAppSettingsRequest>,
) -> Result<Json<AppSettings>, (StatusCode, Json<serde_json::Value>)> {
    if !is_valid_dating(&payload.card_expense_dating) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "card_expense_dating must be 'purchase_date' or 'due_date'"
            })),
        ));
    }

    sqlx::query(
        "INSERT INTO app_settings (id, card_expense_dating, updated_at)
         VALUES (TRUE, $1, NOW())
         ON CONFLICT (id) DO UPDATE
             SET card_expense_dating = EXCLUDED.card_expense_dating,
                 updated_at = NOW()",
    )
    .bind(&payload.card_expense_dating)
    .execute(&state.pg_pool)
    .await
    .map_err(|e| {
        error!("Failed to update app settings: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update settings" })),
        )
    })?;

    Ok(Json(AppSettings {
        card_expense_dating: payload.card_expense_dating,
    }))
}
