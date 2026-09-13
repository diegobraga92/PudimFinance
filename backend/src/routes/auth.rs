//! Endpoints for registration, login, token refresh, and the current user.

#![allow(clippy::result_large_err)]

use axum::extract::State;
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tracing::{error, info};
use uuid::Uuid;

use crate::auth;
use crate::state::AppState;

/// Request body for registering a new user.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct RegisterRequest {
    /// User email (must be unique).
    pub email: String,
    /// Plaintext password (hashed with Argon2id).
    pub password: String,
    /// Optional display name.
    pub display_name: Option<String>,
}

/// Request body for logging in.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct LoginRequest {
    /// User email.
    pub email: String,
    /// Plaintext password.
    pub password: String,
}

/// Request body for refreshing an access token.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct RefreshRequest {
    /// Refresh token issued at login.
    pub refresh_token: String,
}

/// Auth sub-router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/register", axum::routing::post(register))
        .route("/api/auth/login", axum::routing::post(login))
        .route("/api/auth/refresh", axum::routing::post(refresh))
        .route("/api/auth/me", axum::routing::get(me))
}

/// Registers a new user.
#[utoipa::path(
    post,
    path = "/api/auth/register",
    tag = "Auth",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "User registered"),
        (status = 400, description = "Invalid registration payload"),
        (status = 409, description = "Email already registered"),
    ),
)]
pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "A valid email is required" })),
        ));
    }
    if payload.password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Password must be at least 8 characters" })),
        ));
    }

    let password_hash = auth::hash_password(&payload.password).map_err(|e| {
        error!("Failed to hash password: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to register user" })),
        )
    })?;

    let user_id = Uuid::new_v4();
    let insert = sqlx::query(
        "INSERT INTO users (id, email, password_hash, display_name, role)
         VALUES ($1, $2, $3, $4, 'user')",
    )
    .bind(user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&payload.display_name)
    .execute(&state.pg_pool)
    .await;

    match insert {
        Ok(_) => {
            let access = auth::create_token(
                &state.jwt_secret,
                user_id,
                &email,
                "user",
                auth::ACCESS_TOKEN_TTL_SECS,
            )
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "token" })),
                )
            })?;
            let refresh = auth::create_token(
                &state.jwt_secret,
                user_id,
                &email,
                "user",
                auth::REFRESH_TOKEN_TTL_SECS,
            )
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "refresh" })),
                )
            })?;
            info!("Registered user {}", email);
            Ok(Json(json!({
                "access_token": access,
                "refresh_token": refresh,
                "token_type": "Bearer",
                "expires_in": auth::ACCESS_TOKEN_TTL_SECS,
                "user": { "id": user_id, "email": email, "role": "user" },
            })))
        }
        Err(e) => {
            if e.to_string().contains("duplicate key") {
                return Err((
                    StatusCode::CONFLICT,
                    Json(json!({ "error": "Email already registered" })),
                ));
            }
            error!("Failed to insert user: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to register user" })),
            ))
        }
    }
}

/// Logs a user in and returns tokens.
#[utoipa::path(
    post,
    path = "/api/auth/login",
    tag = "Auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful"),
        (status = 401, description = "Invalid credentials"),
    ),
)]
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let email = payload.email.trim().to_lowercase();

    #[derive(sqlx::FromRow)]
    struct UserRow {
        id: Uuid,
        password_hash: String,
        role: String,
    }

    let row: Option<UserRow> =
        sqlx::query_as("SELECT id, password_hash, role FROM users WHERE email = $1")
            .bind(&email)
            .fetch_optional(&state.pg_pool)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "auth fail" })),
                )
            })?;

    let user = row.ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Invalid email or password" })),
    ))?;

    let valid = auth::verify_password(&payload.password, &user.password_hash).unwrap_or(false);
    if !valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid email or password" })),
        ));
    }

    let access = auth::create_token(
        &state.jwt_secret,
        user.id,
        &email,
        &user.role,
        auth::ACCESS_TOKEN_TTL_SECS,
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "token" })),
        )
    })?;
    let refresh = auth::create_token(
        &state.jwt_secret,
        user.id,
        &email,
        &user.role,
        auth::REFRESH_TOKEN_TTL_SECS,
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "refresh" })),
        )
    })?;

    Ok(Json(json!({
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": auth::ACCESS_TOKEN_TTL_SECS,
        "user": { "id": user.id, "email": email, "role": user.role },
    })))
}

/// Refreshes tokens.
#[utoipa::path(
    post,
    path = "/api/auth/refresh",
    tag = "Auth",
    request_body = RefreshRequest,
    responses(
        (status = 200, description = "Tokens refreshed"),
        (status = 401, description = "Invalid or expired refresh token"),
    ),
)]
pub async fn refresh(
    State(state): State<AppState>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let claims = auth::verify_token(&state.jwt_secret, &payload.refresh_token).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or expired refresh token" })),
        )
    })?;

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid token subject" })),
        )
    })?;

    let access = auth::create_token(
        &state.jwt_secret,
        user_id,
        &claims.email,
        &claims.role,
        auth::ACCESS_TOKEN_TTL_SECS,
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "token" })),
        )
    })?;
    let refresh = auth::create_token(
        &state.jwt_secret,
        user_id,
        &claims.email,
        &claims.role,
        auth::REFRESH_TOKEN_TTL_SECS,
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "refresh" })),
        )
    })?;

    Ok(Json(json!({
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": auth::ACCESS_TOKEN_TTL_SECS,
        "user": { "id": user_id, "email": claims.email, "role": claims.role },
    })))
}

/// Returns current user info from Bearer token.
#[utoipa::path(
    get,
    path = "/api/auth/me",
    tag = "Auth",
    responses(
        (status = 200, description = "Current user"),
        (status = 401, description = "Not authenticated"),
    ),
)]
pub async fn me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Missing Bearer" })),
            )
        })?;

    let claims = auth::verify_token(&state.jwt_secret, token).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid or expired token" })),
        )
    })?;

    Ok(Json(json!({
        "id": claims.sub,
        "email": claims.email,
        "role": claims.role,
    })))
}
