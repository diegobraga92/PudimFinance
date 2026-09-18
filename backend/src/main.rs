//! HTTP API server binary.

use axum::Router;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::signal;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use backend::config::Config;
use backend::db::init_pool;
use backend::health::health_handler;
use backend::metrics::init_metrics_recorder;
use backend::openapi::ApiDoc;
use backend::routes::api_router;
use backend::state::AppState;

/// Entry point that initializes telemetry and the database, then serves the HTTP API until shutdown.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let config = Config::from_env();

    backend::telemetry::init_logging(&config.otel_endpoint, "pudimfinance-backend");
    let metrics_recorder = init_metrics_recorder();
    let pg_pool = init_pool(
        &config.database_url,
        config.database_pool_max_connections,
        config.database_pool_acquire_timeout_secs,
    )
    .await;
    let event_publisher = backend::events::EventPublisher::new(&config.rabbitmq_url);
    let google = if config.google_client_ids.is_empty() {
        info!("Google sign-in disabled (GOOGLE_CLIENT_IDS is empty)");
        None
    } else {
        info!(
            "Google sign-in enabled for {} client ID(s)",
            config.google_client_ids.len()
        );
        Some(std::sync::Arc::new(backend::google::GoogleVerifier::new(
            config.google_client_ids.clone(),
            config.google_client_secret.clone(),
            config.google_client_secret_client_id.clone(),
        )))
    };

    let app_state = AppState {
        pg_pool,
        event_publisher,
        jwt_secret: config.jwt_secret.clone(),
        rate_limiter: backend::middleware::RateLimiterState::new(),
        google,
    };

    let recorder = metrics_recorder.clone();
    let app = Router::new()
        .route("/health", axum::routing::get(health_handler))
        // Prometheus metrics (served on the main port for scraping convenience)
        .route(
            "/metrics",
            axum::routing::get(move || {
                let recorder = recorder.clone();
                async move {
                    axum::response::Response::builder()
                        .header("Content-Type", "text/plain; charset=utf-8")
                        .body(axum::body::Body::from(recorder.render()))
                        .unwrap()
                }
            }),
        )
        .merge(api_router())
        .route_layer(axum::middleware::from_fn_with_state(
            app_state.clone(),
            backend::middleware::auth_middleware,
        ))
        // Runs before auth so /api/auth/login is rate-limited too.
        .layer(axum::middleware::from_fn_with_state(
            app_state.clone(),
            backend::middleware::rate_limit_middleware,
        ))
        // Deprecation headers (ADR 009) on legacy v1 endpoints.
        .layer(axum::middleware::from_fn(
            backend::middleware::deprecation_middleware,
        ))
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    let addr: SocketAddr = config
        .server_addr()
        .parse()
        .expect("Invalid server address");
    info!("Starting server on {}", addr);

    let listener = TcpListener::bind(addr).await?;

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("Server shutdown complete");
    Ok(())
}

/// Waits for either Ctrl+C (SIGINT) or SIGTERM to trigger graceful shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received Ctrl+C, starting graceful shutdown");
        }
        _ = terminate => {
            info!("Received SIGTERM, starting graceful shutdown");
        }
    }

    // The OTel tracer provider flushes on drop at program exit.
    info!("Shutdown signal received, OpenTelemetry will flush on drop");
}
