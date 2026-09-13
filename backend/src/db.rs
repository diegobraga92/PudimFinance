use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::info;

/// Creates a PostgreSQL connection pool and applies pending migrations.
///
/// # Panics
/// Panics if the database connection cannot be established or migrations fail to run.
pub async fn init_pool(
    database_url: &str,
    max_connections: u32,
    acquire_timeout_secs: u64,
) -> PgPool {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(std::time::Duration::from_secs(acquire_timeout_secs))
        .connect(database_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    info!("PostgreSQL connection pool established");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");

    info!("Database migrations applied successfully");

    pool
}

/// Checks database liveness by executing a trivial `SELECT 1` query.
pub async fn check_db_health(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1").execute(pool).await.is_ok()
}
