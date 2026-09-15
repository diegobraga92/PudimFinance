use std::env;

/// Application configuration loaded from environment variables at startup.
#[derive(Clone, Debug)]
pub struct Config {
    /// Host address the HTTP server binds to (defaults to `0.0.0.0`).
    pub server_host: String,
    /// Port the HTTP server listens on (defaults to `3000`).
    pub server_port: u16,
    /// PostgreSQL connection URL for the main database.
    pub database_url: String,
    /// Maximum number of connections in the PostgreSQL pool (defaults to 10).
    pub database_pool_max_connections: u32,
    /// Number of seconds to wait when acquiring a connection before timing out (defaults to 10).
    pub database_pool_acquire_timeout_secs: u64,
    /// RabbitMQ connection URL (AMQP).
    pub rabbitmq_url: String,
    /// Secret used to sign JWTs.
    pub jwt_secret: String,
    /// Google OAuth client IDs accepted during ID-token verification.
    pub google_client_ids: Vec<String>,
    /// OpenTelemetry OTLP endpoint for exporting traces (defaults to `http://localhost:4317`).
    pub otel_endpoint: String,
}

impl Config {
    /// Builds a [`Config`] from environment variables, applying defaults.
    ///
    /// # Panics
    /// Panics if the required `DATABASE_URL` environment variable is not set.
    pub fn from_env() -> Self {
        Self {
            server_host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            server_port: env::var("SERVER_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3000),
            database_url: env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            database_pool_max_connections: env::var("DATABASE_POOL_MAX_CONNECTIONS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(10),
            database_pool_acquire_timeout_secs: env::var("DATABASE_POOL_ACQUIRE_TIMEOUT_SECS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(10),
            rabbitmq_url: env::var("RABBITMQ_URL")
                .unwrap_or_else(|_| "amqp://pudim:pudim@localhost:5672".into()),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "dev-secret-change-me-in-production".into()),
            google_client_ids: env::var("GOOGLE_CLIENT_IDS")
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(ToOwned::to_owned)
                .collect(),
            otel_endpoint: env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
                .unwrap_or_else(|_| "http://localhost:4317".into()),
        }
    }

    /// Returns the socket address (`host` and `port`) used to bind the HTTP server.
    pub fn server_addr(&self) -> String {
        format!("{}:{}", self.server_host, self.server_port)
    }
}
