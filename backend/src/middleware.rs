//! Auth middleware that verifies the JWT on protected routes and injects claims.

#![allow(clippy::result_large_err)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use tokio::sync::RwLock;

use crate::auth;
use crate::state::AppState;

/// Fixed-window rate limiter state.
pub struct RateLimiter {
    /// Map of key -> (window_start_epoch_secs, request_count)
    windows: RwLock<HashMap<String, (u64, u32)>>,
}

impl RateLimiter {
    /// Creates an empty rate limiter.
    pub fn new() -> Self {
        Self {
            windows: RwLock::new(HashMap::new()),
        }
    }

    /// Checks and records a request for `key`. Returns `true` if allowed,
    /// `false` if the request exceeds `limit` within the current window.
    pub async fn check(&self, key: &str, limit: u32, window_secs: u64) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let mut windows = self.windows.write().await;
        let entry = windows.entry(key.to_string()).or_insert((now, 0));

        if now.saturating_sub(entry.0) >= window_secs {
            *entry = (now, 0);
        }

        if entry.1 >= limit {
            false
        } else {
            entry.1 += 1;
            true
        }
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// Shared rate limiter stored in app state for use by middleware.
#[derive(Clone, Default)]
pub struct RateLimiterState {
    inner: Arc<RateLimiter>,
}

impl RateLimiterState {
    /// Creates shared state wrapping a rate limiter.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RateLimiter::new()),
        }
    }

    /// Delegates to the underlying limiter.
    pub async fn check(&self, key: &str, limit: u32, window_secs: u64) -> bool {
        self.inner.check(key, limit, window_secs).await
    }
}

/// Extracts the `Authorization` header with a Bearer token, verifies the JWT, and injects claims.
///
/// Skips the public paths `/api/auth/*`, `/health`, and `/metrics`.
pub async fn auth_middleware(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();

    if path.starts_with("/api/auth/") || path == "/health" || path == "/metrics" {
        return next.run(req).await;
    }

    let mut req = req;
    let token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| unauthorized("Missing Bearer token"))
        .and_then(|t| {
            auth::verify_token(&state.jwt_secret, t)
                .map_err(|_| unauthorized("Invalid or expired token"))
        });

    match token {
        Ok(claims) => {
            req.extensions_mut().insert(claims);
            next.run(req).await
        }
        Err(resp) => resp,
    }
}

/// Deprecation middleware that attaches `Sunset`, `Deprecation`, and `Link`
/// headers to legacy v1 endpoints with a v2 successor (ADR 009).
pub async fn deprecation_middleware(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut response = next.run(req).await;

    // Only the v1 ledger path is deprecated in this simulation.
    if path == "/api/ledger/transactions" {
        response.headers_mut().insert(
            "Sunset",
            axum::http::HeaderValue::from_static("Sun, 01 Jan 2027 00:00:00 GMT"),
        );
        response
            .headers_mut()
            .insert("Deprecation", axum::http::HeaderValue::from_static("true"));
        response.headers_mut().insert(
            "Link",
            axum::http::HeaderValue::from_static(
                "</api/v2/ledger/transactions>; rel=\"successor-version\"",
            ),
        );
    }

    response
}

/// Rate limiting middleware with fixed-window per-IP limits on write endpoints.
///
/// Returns HTTP 429 when the limit is exceeded.
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().to_string();

    let is_write = matches!(method.as_str(), "POST" | "PUT" | "DELETE");
    if !is_write {
        return next.run(req).await;
    }

    let key = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let (limit, window) = if path == "/api/auth/login" {
        (10, 60u64)
    } else {
        (120, 60u64)
    };

    if !state.rate_limiter.check(&key, limit, window).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            axum::Json(json!({ "error": "Rate limit exceeded. Try again later." })),
        )
            .into_response();
    }

    next.run(req).await
}

/// Helper for creating a 401 JSON response.
fn unauthorized(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(json!({ "error": message })),
    )
        .into_response()
}
