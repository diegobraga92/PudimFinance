# Security threat model

This document covers the current Compose/Tauri deployment. It records controls
that exist in the repository and gaps that must be handled by a production
deployment.

## Components

| Component | Security boundary |
|---|---|
| Tauri desktop/Android client | OS keyring, Android Keystore, native plugin permissions |
| Browser client | Browser storage and nginx same-origin proxy |
| Backend | JWT/RBAC middleware, rate limiting, validation, database access |
| PostgreSQL | Primary application and audit data |
| RabbitMQ | Best-effort event transport; not the source of truth |
| Prometheus/Grafana | Operational data and dashboards |

## Threats and controls

| Threat | Risk | Current control or gap |
|---|---|---|
| Unauthenticated API access | High | JWT required for protected `/api/*` routes; auth, health, and metrics are public by design |
| Forged admin token | High | HMAC-signed JWTs and server-derived roles; admin middleware gates admin handlers |
| Stolen access token replay | Medium | Access tokens expire after 15 minutes and refresh tokens after 7 days; rotation/revocation is not implemented |
| Password compromise | High | Argon2id password hashes; production deployments must protect `JWT_SECRET` and database credentials |
| Transaction tampering | High | Balanced ledger validation and append-only ledger/event records |
| SQL injection | High | SQLx parameters are used for user-controlled values |
| Sensitive error disclosure | Medium | Client errors are generic while detailed failures are logged through tracing |
| Brute-force writes/login | Medium | In-memory fixed-window limiter: 10 login writes/minute and 120 other writes/minute per forwarded IP |
| Public metrics or Swagger exposure | Medium | Compose exposes them for local operations; restrict access at the reverse proxy in production |
| Permissive CORS | Medium | Required for direct client/server development; replace with an allowlist for internet-facing deployment |
| Cleartext Android traffic | Medium | Release setup allows it for LAN HTTP by default; set `PUDIM_ALLOW_CLEARTEXT=false` and use HTTPS when possible |
| Broker outage | Low for data integrity | Database commits continue; RabbitMQ publication is best effort and events remain in PostgreSQL |
| Backup loss | High | `scripts/backup.sh` creates dumps, but scheduling, retention, encryption, and restore testing are deployment responsibilities |

## Deployment requirements

Before exposing the API beyond a trusted LAN:

1. Replace development passwords and `JWT_SECRET`.
2. Terminate HTTPS and restrict CORS to known client origins.
3. Keep PostgreSQL, RabbitMQ management, Prometheus, and Grafana off the public interface.
4. Store backups encrypted, retain multiple restore points, and test restoration.
5. Review the public `ecs_tasks` ingress in `infra/main.tf`; the Terraform directory is not a hardened production deployment.