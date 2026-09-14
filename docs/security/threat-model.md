# STRIDE Threat Model — PudimFinance

> Security analysis using the STRIDE methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege).
> Date: 2026-08-06 | Status: Draft

---

## Components In Scope

| Component | Description |
|-----------|-------------|
| **Desktop / Android app** | Tauri 2 client (`desktop/`): Rust core + system webview, OS keyring / Android Keystore token storage |
| **Web UI** | The same React frontend served by nginx (port 5173/80) with a same-origin API proxy; tokens fall back to `localStorage` |
| **Backend** | Rust/Axum API (port 3000) |
| **PostgreSQL** | Main data store (port 5432) |
| **RabbitMQ** | Event broker (amqp 5672, mgmt 15672) |
| **Prometheus/Grafana** | Observability stack (9090/3001) |

---

## STRIDE Analysis

### 1. Spoofing — identity forgery

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Attacker calls API without valid identity | **High** | JWT bearer tokens required on all `/api/*` routes (auth middleware); `/api/auth/*`, `/health`, `/metrics` are public by design |
| Attacker forges JWT to impersonate admin | **High** | HMAC-SHA256 signed tokens with `JWT_SECRET`; tokens carry `role` claim; `require_admin` middleware gates admin endpoints |
| Attacker replays a stolen token | **Medium** | Access tokens short-lived (15 min); refresh tokens 7 days; consider refresh-token rotation + revocation in future |
| User fakes email on registration | **Low** (personal app) | Email format validation; no verification flow (single-user study project) |

### 2. Tampering — data modification

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Modify transaction amounts | **High** | Ledger entries are immutable (append-only); accounting equation (debits=credits) enforced server-side; amount = `NUMERIC(12,2)` |
| Tamper with event history | **High** | `events` table is append-only (BIGSERIAL, no UPDATE path exposed); backend never deletes events |
| Modify budgets/categories after the fact | **Medium** | Budgets support upsert (idempotent) but are mutable by design; acceptable for the app's purpose |
| CSV injection through reconciliation upload | **Medium** | Reconciliation input is validated server-side; amounts limited; descriptions length-capped |

### 3. Repudiation — denying actions

| Threat | Risk | Mitigation |
|--------|------|-----------|
| User denies creating a transaction | **Medium** | `events` table records `TransactionRecorded` with full payload, timestamp, and aggregate_id — an immutable audit trail |
| User denies logging in | **Low** | Auth events could be recorded; currently not logged to events table (future enhancement) |
| Admin denies accessing audit | **Low** | Audit endpoint is admin-gated; future enhancement to log admin access itself |

### 4. Information Disclosure — unauthorized data access

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Error messages leak DB schema | **Medium** | API returns generic `"Failed to ..."` messages; internal SQL/errors logged only via `tracing` (not exposed to client) |
| Receipt images contain PII | **Future** | Receipt scanner stores images; PII scrubbing + encryption at rest is planned (Layer 4c) |
| `/metrics` leaks internals | **Low** | Prometheus endpoint currently public for scraping; acceptable for study project, but should be firewalled in production |
| Swagger UI exposes full API contract | **Low** | `/swagger-ui` is public; fine for study, restrict in production |

### 5. Denial of Service — resource exhaustion

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Brute-force login attempts | **Medium** | Rate limiting planned (per-user token bucket); Argon2id slows password cracking |
| Large reconciliation uploads | **Medium** | Payload size limited; reconciliation endpoint is admin/moderated |
| Excessive report queries | **Low** | Indexes added (migration 004); SLOs track P95/P99 |
| RabbitMQ message flood | **Low** | Messages are fire-and-forget; producer is single-user |

### 6. Elevation of Privilege — gaining higher rights

| Threat | Risk | Mitigation |
|--------|------|-----------|
| User escalates to admin role | **High** | `role` claim is signed into JWT server-side; role comes from DB (`users.role`), not client input; `require_admin` enforces on migration + audit endpoints |
| SQL injection to escalate | **Medium** | All queries use parameterized `sqlx` binds — no string interpolation for user input |

---

## Security Controls Summary

| Control | Status |
|---------|--------|
| JWT authentication (access + refresh) | ✅ Implemented |
| Argon2id password hashing | ✅ Implemented |
| RBAC (`user` / `admin`) | ✅ Implemented (middleware + admin-gated audit endpoint) |
| Rate limiting | ⏳ Planned (in-memory token bucket) |
| CORS | ✅ Permissive (dev); harden to allowlist in production |
| TLS | ⏳ Terminated at reverse proxy (nginx) — configure HTTPS in prod |
| Dependency scanning | ⏳ Add `trivy` to CI |
| Input validation | ✅ Amount/date/category validated; harden lengths later |
| Audit trail | ✅ `events` table + `/api/audit/events` admin endpoint |
| Secrets management | ⚠️ `JWT_SECRET` in env; document rotation + use Docker secrets in prod |

---

## Outstanding Work Items

1. Add rate limiting middleware (tower token bucket per user/IP)
2. Harden input validation (description/amount max lengths, future-date rejection)
3. Add `trivy` container scan to CI
4. Configure CORS allowlist + TLS in production nginx
5. Harden Prometheus/Grafana access (reverse-proxy auth)
6. (Layer 4c) Receipt image PII scrubbing + encryption at rest