use axum::{routing::get, Router};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use std::net::SocketAddr;
use tokio::net::TcpListener;

/// Total double-entry ledger transactions created.
pub const METRIC_LEDGER_TX: &str = "pudim_ledger_transactions_total";
/// Total RabbitMQ event publish failures.
pub const METRIC_LEDGER_PUBLISH_FAILURES: &str = "pudim_ledger_event_publish_failures_total";
/// Active PostgreSQL pool connections.
pub const METRIC_DB_POOL: &str = "pudim_db_pool_active_connections";
/// Whether RabbitMQ is reachable (1/0).
pub const METRIC_RABBITMQ: &str = "pudim_rabbitmq_connected";

/// Installs the global Prometheus metrics recorder and returns a handle
/// for rendering metrics on demand.
pub fn init_metrics_recorder() -> PrometheusHandle {
    let recorder_handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("Failed to install Prometheus recorder");

    // Describe eagerly so zero-valued series still appear in Grafana.
    metrics::describe_counter!(
        METRIC_LEDGER_TX,
        "Total number of double-entry ledger transactions created"
    );
    metrics::describe_counter!(
        METRIC_LEDGER_PUBLISH_FAILURES,
        "Total number of RabbitMQ event publish failures"
    );
    metrics::describe_gauge!(
        METRIC_DB_POOL,
        "Active PostgreSQL connection pool connections"
    );
    metrics::describe_gauge!(
        METRIC_RABBITMQ,
        "Whether RabbitMQ is reachable (1=connected, 0=disconnected)"
    );

    tracing::info!("Prometheus metrics recorder initialized");
    recorder_handle
}

/// Increments the ledger transaction counter.
pub fn inc_ledger_transactions() {
    metrics::counter!(METRIC_LEDGER_TX).increment(1);
}

/// Increments the RabbitMQ publish failure counter.
pub fn inc_ledger_event_publish_failures() {
    metrics::counter!(METRIC_LEDGER_PUBLISH_FAILURES).increment(1);
}

/// Sets the RabbitMQ connection gauge (1 = connected, 0 = disconnected).
pub fn set_rabbitmq_connected(connected: bool) {
    metrics::gauge!(METRIC_RABBITMQ).set(if connected { 1.0 } else { 0.0 });
}

/// Sets the DB pool active-connection gauge.
///
/// Kept as a helper for future wiring (would be fed by a periodic PgPool poll).
#[allow(dead_code)]
pub fn set_db_pool_active_connections(value: f64) {
    metrics::gauge!(METRIC_DB_POOL).set(value);
}

/// Builds an axum router serving Prometheus metrics in text format on `/metrics`.
#[allow(dead_code)]
pub fn metrics_handler(recorder: PrometheusHandle) -> Router {
    Router::new().route(
        "/metrics",
        get(move || {
            let recorder = recorder.clone();
            async move {
                axum::response::Response::builder()
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .body(axum::body::Body::from(recorder.render()))
                    .unwrap()
            }
        }),
    )
}

/// Starts a dedicated metrics HTTP server on a separate port (e.g. 3001).
/// This keeps the main API port clean from Prometheus scrapes.
#[allow(dead_code)]
pub async fn start_metrics_server(recorder: PrometheusHandle, port: u16) {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let router = metrics_handler(recorder);

    tracing::info!("Metrics server starting on {}", addr);

    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind metrics server");

    axum::serve(listener, router)
        .await
        .expect("Metrics server failed");
}
