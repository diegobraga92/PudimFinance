//! Backend library crate exposing the API server internals to sibling binaries.

#![warn(missing_docs)]
#![warn(rustdoc::broken_intra_doc_links)]

/// Authentication for JWT creation and verification, password hashing, and RBAC claims.
pub mod auth;
/// Environment-based application configuration.
pub mod config;
/// PostgreSQL connection pool and migration helpers.
pub mod db;
/// RabbitMQ event publishing for the ledger.
pub mod events;
/// Google OAuth authorization-code exchange and ID-token verification.
pub mod google;
/// Health check endpoint and response types.
pub mod health;
/// Double-entry ledger logic (balance validation, account mapping).
pub mod ledger;
/// Prometheus metrics collection and serving.
pub mod metrics;
/// Auth middleware and RBAC helpers.
pub mod middleware;
/// API and database models.
pub mod models;
/// Best-effort enrichment from public NFC-e consultation pages.
pub mod nfce_portal;
/// OpenAPI 3.1 spec generation via utoipa.
pub mod openapi;
/// Receipt text parsing for OCR-assisted scanning.
pub mod receipt_ocr;
/// NFC-e QR code parsing for receipt scanning.
pub mod receipt_scanner;
/// Bank statement parsing (CSV/OFX) for reconciliation.
pub mod reconciliation_parser;
/// HTTP route handlers, grouped by resource.
pub mod routes;
/// Shared application state for axum handlers.
pub mod state;
/// Logging and OpenTelemetry tracing initialization.
pub mod telemetry;
/// Transaction-to-ledger posting service.
pub mod transaction_ledger;

pub use openapi::ApiDoc;
