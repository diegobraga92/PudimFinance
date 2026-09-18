//! Publishes ledger events to the RabbitMQ fanout exchange.

use anyhow::Result;
use deadpool_lapin::{Config, Pool, PoolConfig, Runtime};
use lapin::options::ExchangeDeclareOptions;
use lapin::types::FieldTable;
use lapin::{BasicProperties, ConnectionProperties, ExchangeKind};
use serde::Serialize;
use tracing::{error, info, warn};

use crate::metrics;

/// Exchange name for ledger transaction events.
pub const LEDGER_EXCHANGE: &str = "finance.ledger.transactions";

/// Event payload for a recorded transaction.
#[derive(Debug, Clone, Serialize)]
pub struct TransactionRecordedEvent {
    /// Unique transaction ID.
    pub transaction_id: String,
    /// Human-readable description.
    pub description: String,
    /// Calendar date (ISO `YYYY-MM-DD`).
    pub date: String,
    /// Recorded timestamp (ISO 8601).
    pub recorded_at: String,
    /// The transaction entries.
    pub entries: Vec<EventEntry>,
}

/// A single event entry.
#[derive(Debug, Clone, Serialize)]
pub struct EventEntry {
    /// Account ID.
    pub account_id: String,
    /// Account name.
    pub account_name: Option<String>,
    /// Debit amount.
    pub debit_amount: String,
    /// Credit amount.
    pub credit_amount: String,
}

/// RabbitMQ pool for publishing events.
#[derive(Clone)]
pub struct EventPublisher {
    pool: Pool,
}

impl EventPublisher {
    /// Creates a new publisher from the RMQ URL.
    ///
    /// Panics if the pool cannot be created (the URL is malformed).
    pub fn new(rabbitmq_url: &str) -> Self {
        // Build the pool via `deadpool_lapin::Config`; this is the supported way
        // to select the async runtime in deadpool-lapin 0.14+ (the runtime is
        // baked into the `Manager` at construction time).
        let config = Config {
            url: Some(rabbitmq_url.to_string()),
            pool: Some(PoolConfig {
                max_size: 5,
                ..Default::default()
            }),
        };

        let pool = config
            .create_pool(ConnectionProperties::default, Runtime::Tokio1)
            .expect("Failed to create RabbitMQ pool");

        let publisher = Self { pool };

        // Best-effort async setup. Declare the exchange and spawn a task to
        // retry until connected (RabbitMQ may not be up yet at backend start).
        let pool_clone = publisher.pool.clone();
        tokio::spawn(async move {
            loop {
                match pool_clone.get().await {
                    Ok(conn) => {
                        let channel_result = conn.create_channel().await;
                        match channel_result {
                            Ok(channel) => {
                                let declare_result = channel
                                    .exchange_declare(
                                        LEDGER_EXCHANGE.into(),
                                        ExchangeKind::Fanout,
                                        ExchangeDeclareOptions {
                                            durable: true,
                                            ..Default::default()
                                        },
                                        FieldTable::default(),
                                    )
                                    .await;
                                match declare_result {
                                    Ok(_) => {
                                        info!("RabbitMQ exchange '{}' declared", LEDGER_EXCHANGE);
                                        break;
                                    }
                                    Err(e) => {
                                        warn!("Failed to declare exchange, retrying: {}", e);
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("Failed to create channel, retrying: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("RabbitMQ not reachable yet, retrying: {}", e);
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        });

        publisher
    }

    /// Publishes a `TransactionRecorded` event to the fanout exchange.
    ///
    /// Returns `Ok(())` on success. If RabbitMQ is unavailable, logs a warning
    /// and returns `Ok(())`. Events are recoverable from the DB `events` table,
    /// so the ledger itself is never blocked on the broker.
    pub async fn publish_transaction_recorded(
        &self,
        event: &TransactionRecordedEvent,
    ) -> Result<()> {
        let body = serde_json::to_vec(event)?;

        match self.pool.get().await {
            Ok(conn) => {
                let channel_result = conn.create_channel().await;
                match channel_result {
                    Ok(channel) => {
                        let publish_result = channel
                            .basic_publish(
                                LEDGER_EXCHANGE.into(),
                                "".into(),
                                Default::default(),
                                body.as_slice(),
                                BasicProperties::default()
                                    .with_content_type("application/json".into())
                                    .with_delivery_mode(2), // persistent
                            )
                            .await;
                        match publish_result {
                            Ok(_) => {
                                metrics::set_rabbitmq_connected(true);
                                info!(
                                    "Published TransactionRecorded event for tx {}",
                                    event.transaction_id
                                );
                                Ok(())
                            }
                            Err(e) => {
                                metrics::inc_ledger_event_publish_failures();
                                metrics::set_rabbitmq_connected(false);
                                error!("Failed to publish event to RabbitMQ: {}", e);
                                Ok(()) // recoverable — events are stored in DB
                            }
                        }
                    }
                    Err(e) => {
                        metrics::set_rabbitmq_connected(false);
                        warn!("Failed to create channel, skipping publish: {}", e);
                        Ok(())
                    }
                }
            }
            Err(e) => {
                metrics::set_rabbitmq_connected(false);
                warn!("RabbitMQ connection unavailable, skipping publish: {}", e);
                Ok(())
            }
        }
    }

    /// Convenience for constructing a `TransactionRecordedEvent` from ledger data.
    #[allow(clippy::too_many_arguments)]
    pub fn make_transaction_recorded_event(
        transaction_id: &uuid::Uuid,
        description: &str,
        date: &chrono::NaiveDate,
        entries: &[crate::models::LedgerEntry],
    ) -> TransactionRecordedEvent {
        TransactionRecordedEvent {
            transaction_id: transaction_id.to_string(),
            description: description.to_string(),
            date: date.to_string(),
            recorded_at: entries
                .first()
                .map(|e| e.recorded_at.to_rfc3339())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            entries: entries
                .iter()
                .map(|e| EventEntry {
                    account_id: e.account_id.to_string(),
                    account_name: e.account_name.clone(),
                    debit_amount: e.debit_amount.to_string(),
                    credit_amount: e.credit_amount.to_string(),
                })
                .collect(),
        }
    }

    /// Returns whether RabbitMQ is currently reachable (used by health check).
    pub async fn is_healthy(&self) -> bool {
        match self.pool.get().await {
            Ok(conn) => conn.create_channel().await.is_ok(),
            Err(_) => false,
        }
    }
}
