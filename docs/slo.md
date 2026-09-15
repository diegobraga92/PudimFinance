# Service objectives

These are target values for a small self-hosted deployment, not measured
production guarantees. Replace them with observed values after collecting a
representative workload.

## Health endpoint

| Metric | Target | Window |
|---|---:|---|
| Availability | 99.9% | 30 days |
| P50 latency | < 10 ms | 5 minutes |
| P99 latency | < 50 ms | 5 minutes |

A 99.9% monthly availability target allows approximately 43 minutes of
downtime. The repository currently exposes Prometheus metrics but does not ship
a blackbox exporter or Alertmanager configuration; operators must provide those
components if they need synthetic probing and paging.

## Endpoint classes

| Class | Examples | Target P95 |
|---|---|---:|
| Health/metrics | `/health`, `/metrics` | < 50 ms |
| CRUD | categories, accounts, transactions, budgets | < 150 ms |
| Aggregation | summary, reports, budget summary | < 300 ms |
| Ledger/reconciliation | ledger writes, migration, statement upload | < 2 s |
| Receipt parsing | QR/OCR parsing and receipt writes | < 3 s |

Measure each class with the actual dataset and request mix. The complete route
contract is in `api/openapi/openapi.json`.

## Reliability targets

- Transaction writes must be atomic and must not create unbalanced ledger rows.
- RabbitMQ outages must not prevent database-backed writes.
- A database backup restore must be tested before relying on its RPO.
- Offline client mutations should converge after connectivity returns.

## Reporting

Prometheus scrapes `backend:3000/metrics` in Compose. Grafana is provisioned
with the repository dashboard. This repository does not include alert routing or
an operations channel; configure those in the deployment environment.