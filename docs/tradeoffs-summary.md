# Tradeoffs summary

This document records the current architectural tradeoffs. Detailed decisions
are in the [ADRs](adr/).

| Area | Current choice | Main tradeoff |
|---|---|---|
| Backend | Rust + Axum + Tokio | Strong typing and predictable memory use; slower onboarding and builds |
| API contract | Code-first `utoipa` → committed OpenAPI | Rust is the contract source; design-first editing is not supported |
| Transactions | Simple transaction rows plus balanced ledger postings | Backward-compatible reads, but two representations must remain consistent |
| Events | PostgreSQL `events` table plus RabbitMQ fanout | Writes survive broker outages; broker messages are best effort |
| Idempotency | Server-side idempotency records where supported | Extra database state in exchange for safe retries |
| Budgets | Monthly limits with read-time aggregation | Simple and consistent; reports become more expensive at high volume |
| Isolation | PostgreSQL `READ COMMITTED` transactions | Lower retry cost; stronger isolation is not used for ledger writes |
| Reconciliation | Amount and date matching with user review | Predictable matching; no fuzzy description matching |
| Receipts | NFC-e QR and OCR-text parsing | Server-backed parsing is simple; image capture/OCR pipelines are out of scope |
| Auth | JWT access/refresh tokens, Argon2id, user/admin roles | Appropriate for the app; token revocation and rotation are not implemented |
| Rate limiting | In-memory fixed window per forwarded IP | No extra service; limits are process-local |
| Observability | Prometheus exporter and tracing | Simple local setup; production retention and alerting need deployment work |

## Known limitations

- RabbitMQ messages published during an outage require a replay process from the
  PostgreSQL event table.
- The browser fallback stores tokens in `localStorage`; use Tauri builds when
  OS-backed storage is required.
- The Terraform directory does not provision a complete AWS application stack.
- SLO and benchmark figures in the documentation are targets or local
  observations, not production guarantees.