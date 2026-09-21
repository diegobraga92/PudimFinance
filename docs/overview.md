# PudimFinance — Project Overview

> Onboarding and architecture reference. The root [`README.md`](../README.md) is
> the quickstart (install, run, ports); this document explains **what the system
> is, how it is built, and why**. Deep operational detail stays in the linked
> runbooks and ADRs.

## 1. What it is

PudimFinance is a **self-hosted personal finance application**. One React +
TypeScript frontend is rendered three ways — Tauri 2 desktop, Tauri 2 Android
(WebView), and a static browser SPA behind nginx — and talks to a **Rust/Axum**
HTTP API backed by **PostgreSQL** and **RabbitMQ**.

The design in one line: *PostgreSQL is the source of truth for money and events;
RabbitMQ is a best-effort fanout side effect; the client is offline-first and
reconciles through an outbox.*

It is a **single-tenant** application. Transactions, accounts, categories,
budgets, and receipts form one shared dataset with no `user_id` column; the
`users` table exists for authentication and carries a `role` column that is not
yet enforced anywhere (see [§13](#13-known-limitations-and-gotchas)).

### Capabilities

- Income and expense transactions with categories and subcategories
- Accounts, balances, transfers, credit cards, card bills ("faturas"),
  installment plans, and installment anticipation
- Monthly budgets, denormalized alerts, cash-flow and category reports
- Double-entry ledger mirror, single→double migration, immutable audit events
- CSV/OFX bank-statement reconciliation with match history
- Brazilian NFC-e receipt scanning — QR via camera or picture, OCR via camera or
  picture — with best-effort public DANFE enrichment, product normalization, and
  price history
- Android notification capture (bank alerts), biometric lock, and home-screen
  spending widgets
- Offline mirror (IndexedDB) with a queued, retrying mutation outbox

## 2. Stack

| Layer | Technology |
|---|---|
| API | Rust 2021, Axum 0.8, Tokio, Tower |
| Persistence | PostgreSQL 16 (Compose) via SQLx 0.9 + migrations (`sqlx::migrate!`) |
| Events | RabbitMQ 3.13 (Compose) via `lapin`/`deadpool-lapin`; durable fanout exchange `finance.ledger.transactions` |
| Auth | HS256 JWT access + refresh, Argon2id passwords, optional Google Sign-In |
| Client | React 18, TypeScript, Vite, Tailwind, TanStack Query, React Router (`HashRouter`), Radix primitives, Recharts |
| Native shell | Tauri 2 (desktop + Android), Kotlin plugin `pudim-android-native` |
| Offline | IndexedDB mirror + `pending_operations` queue; encrypted Android `SyncOutbox` + WorkManager |
| Receipt tooling | `jsqr` (client QR decode), `tesseract.js` (client OCR) |
| API contract | `utoipa` annotations → committed OpenAPI JSON → `openapi-typescript` types |
| Observability | Prometheus exporter, provisioned Grafana dashboard, `tracing` + OpenTelemetry/OTLP |
| CI | GitHub Actions: backend (fmt, clippy, OpenAPI diff, build, tests, `cargo audit`) and desktop (typecheck, lint, smoke tests, Tauri/Android/web builds) |

## 3. Repository map

```text
backend/         Rust API: routes/, ledger, receipts, migrations/, tests, OpenAPI generator
desktop/         React/Tauri client
  src/             UI: app/ (shell, providers), features/, components/, lib/, offline/, notifications/
  src-tauri/       Rust core (keyring, OAuth loopback) + plugins/pudim-android-native/
  scripts/         Node smoke tests (offline, android shell, widget, qr, timeouts, icons)
shared/          Framework-agnostic TS: i18n (en, pt-BR), account + category icon catalogs
api/openapi/     Committed OpenAPI contract (generated)
infra/           Partial AWS/Terraform foundation — NOT a complete deployment
docs/            This doc, adr/, runbooks/, security/, slo, capacity, database notes
scripts/         Dev/CI/backup/load/Android helpers
```

`desktop/` imports `shared/` through the `@shared` Vite alias, so browser/web
image builds must use the **repository root** as Docker build context.

## 4. System context

```mermaid
flowchart TB
    User([User])
    subgraph Clients
        Desktop["Tauri desktop app"]
        Android["Tauri Android app"]
        Browser["Browser SPA behind nginx"]
    end
    API["PudimFinance API<br/>Axum :3000"]
    PG[("PostgreSQL<br/>source of truth")]
    RMQ[("RabbitMQ<br/>best-effort fanout")]
    Prom["Prometheus"]
    Graf["Grafana"]

    User --> Desktop
    User --> Android
    User --> Browser
    Desktop -->|"JSON over HTTP /api"| API
    Android -->|"JSON over HTTP /api"| API
    Browser -->|"same-origin /api proxy"| API
    API -->|SQLx| PG
    API -->|"AMQP publish, best effort"| RMQ
    Prom -->|"scrape /metrics"| API
    Graf -->|PromQL| Prom
```

### Compose services

The supported deployment is a single Docker Compose stack. The `web` service is
the only client-resident container; native clients reach the backend directly.

| Service | Image | Host port | Role |
|---|---|---:|---|
| `postgres` | `postgres:16-alpine` | 5432 | Primary data store |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | 5672, 15672 | Event broker + management UI |
| `backend` | `backend/Dockerfile` | 3000 | API, migrations, metrics |
| `web` | `desktop/Dockerfile.web` | 5173 | Browser SPA + same-origin API proxy |
| `prometheus` | `prom/prometheus:v2.53.0` | 9090 | Metrics storage |
| `grafana` | `grafana/grafana:11.1.0` | 3001 | Provisioned dashboard |

`infra/` (Terraform) is intentionally separate and only a partial foundation; it
does not provision the application. See [`../infra/README.md`](../infra/README.md).

## 5. Backend request pipeline

Middleware order is significant and is set in `backend/src/main.rs`. Layers
applied later wrap earlier ones, so the outer-to-inner order is:
CORS → tracing → deprecation → rate limit → auth → handler.

```mermaid
flowchart TD
    Req["HTTP request"] --> Cors["CorsLayer (permissive)"]
    Cors --> Trace["TraceLayer (tracing spans)"]
    Trace --> Dep["Deprecation middleware<br/>Sunset/Deprecation/Link on /api/ledger/transactions"]
    Dep --> RL{"Rate limit (writes only)<br/>keyed by first X-Forwarded-For"}
    RL -->|"over limit"| TooMany["429 Too Many Requests"]
    RL -->|"login 10/min, other writes 120/min"| Auth{"Auth middleware<br/>public: /api/auth/*, /health, /metrics"}
    Auth -->|"missing or invalid Bearer"| Unauth["401 Unauthorized"]
    Auth -->|"JWT claims injected"| Routes["Route handlers (backend/src/routes/*)"]
    Routes --> Domain["Domain helpers: ledger, transaction_ledger,<br/>receipt_scanner/ocr, nfce_portal, reconciliation_parser"]
    Domain --> Pool[("SQLx PostgreSQL pool")]
    Routes --> Metrics["Prometheus recorder (/metrics)"]
    Domain --> Pub["EventPublisher"]
    Pub --> RMQ[("finance.ledger.transactions")]
```

Rate limiting runs before auth precisely so `/api/auth/login` is limited too.
`/health` returns 503 only when PostgreSQL is unreachable; RabbitMQ is reported
as `connected`/`connecting` without failing the check.

## 6. Core data model

```mermaid
erDiagram
    accounts ||--o{ accounts : "parent of"
    accounts ||--o{ ledger_entries : "posted to"
    accounts ||--o{ card_bills : "billing cycle"
    categories ||--o{ categories : "parent of"
    categories }o--o| accounts : "maps to a posting account"
    transactions }o--o| categories : "categorized as"
    transactions }o--o| accounts : "source account"
    transactions ||--o{ ledger_entries : "legacy join key"
    installment_plans ||--o{ installment_transactions : "has"
    installment_plans }o--o| categories : "uses"
    transactions }o--o| installment_plans : "generated from"
    card_bills ||--o{ installment_transactions : "anticipated into"
    accounts ||--o{ installment_anticipations : "anticipates"
    categories ||--o{ budgets : "limits"
    budgets ||--o{ budget_alerts : "raises"
    stores ||--o{ receipts : "issued"
    receipts ||--o{ receipt_items : "contains"
    normalized_products ||--o{ receipt_items : "normalized to"
    reconciliations ||--o{ reconciliation_items : "contains"
```

### Invariants that must not be broken

- **`ledger_entries` is append-only.** Each row has exactly one non-zero side
  (`chk_debit_or_credit`); the debit and credit legs of a transaction must sum
  equal and are validated in `backend/src/ledger.rs` before commit.
- **`ledger_entries.transaction_id` is a grouping key, not a foreign key.** By
  convention it equals `transactions.id`; legacy rows may instead be linked via
  `transactions.ledger_transaction_id`. `transaction_ledger::delete_entries`
  handles both.
- **New transaction writes maintain both representations** — a `transactions`
  row *and* a balanced `ledger_entries` pair. See [ADR 003](adr/003-start-simple-single-entry.md).
- **Posting-account resolution falls back, never fails.** `resolve_posting_account`
  tries: explicit `categories.ledger_account_id` → an account matching the
  category name/type → creates and links one → a generic account (`Other Income`
  / `Miscellaneous`) → any account of the required type. A stale `category_id`
  must degrade, not 500.
- **`events` is immutable** (`BIGSERIAL`, JSONB payload) and is the durable
  record consumed for audit and manual replay; RabbitMQ is not the source of truth.
- **Money is `NUMERIC(12,2)`; dates are `DATE`.** Reports use half-open date
  ranges (`>= start AND < end`) so indexes apply — see
  [`database-performance.md`](database-performance.md).
- **Card dating is configurable.** SQL functions `card_bill_due_date` and
  `effective_transaction_date` implement the billing cycle and the
  `app_settings.card_expense_dating` choice of `purchase_date` vs `due_date`.
- **Budgets are upserted per `(category_id, month, year)`**; the overall monthly
  budget is a row with `category_id IS NULL` (guarded by its own partial unique
  index). Parent budgets include descendant spending; ancestor/descendant
  overlaps are rejected.
- **Stores are deduplicated** by CNPJ when present, otherwise by `lower(name)`.
- **`users`**: unique email, `password_hash` nullable for Google-only accounts,
  unique `google_sub`; a check requires at least one auth method.

## 7. Key flows

### 7.1 Transaction write → ledger → event → broker

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant H as Axum handler
    participant PG as PostgreSQL
    participant RMQ as RabbitMQ

    C->>H: POST /api/transactions (or /api/ledger/transactions)
    H->>H: Validate description, positive amount, type income or expense
    H->>PG: BEGIN
    H->>PG: Resolve posting account for category (link / match / create / fallback)
    H->>PG: INSERT transactions
    H->>PG: INSERT ledger_entries (balanced debit + credit)
    H->>PG: INSERT events (TransactionRecorded payload)
    H->>PG: COMMIT
    H-->>RMQ: basic_publish (persistent, confirm-less, best effort)
    Note over H,RMQ: A publish failure is logged and counted but does not fail the write;<br/>the event stays queryable in PostgreSQL for manual replay
    H-->>C: 200/201 with transaction + ledger id
```

### 7.2 Offline-first client sync

The client writes locally first, then reconciles. `POST /api/sync/push` applies
queued mutations and `POST /api/sync/pull` returns everything changed since a
timestamp (transactions and categories by `updated_at`/`created_at`; accounts are
returned in full because they have no `updated_at`).

```mermaid
sequenceDiagram
    autonumber
    participant UI as React UI
    participant IDB as IndexedDB mirror + queue
    participant Eng as sync-engine
    participant Native as Android outbox (WorkManager)
    participant API as API (/api/sync/*)

    UI->>IDB: Write local row + enqueue pending operation
    UI->>Native: Mirror operation into encrypted SyncOutbox (Android only)
    Eng->>IDB: Read pending ops (skip ops with 3 failed attempts)
    Eng->>API: POST /api/sync/push [operations]
    API-->>Eng: Per-op result (server_id, status, warning or error)
    Eng->>IDB: Mark synced / record failure
    Eng->>API: POST /api/sync/pull { last_synced_at }
    API-->>Eng: Changed transactions + categories, all accounts, server_time
    Eng->>IDB: Replace mirror
    Note over Native,API: WorkManager pushes the same ops while the app is closed;<br/>results are reconciled (drain) on next open
```

### 7.3 Android notification capture

Android-only. A native `NotificationListenerService` watches bank notifications,
parses them, and either imports silently or posts an actionable prompt.

```mermaid
flowchart TD
    N["Bank app posts a notification"] --> L["NotificationListenerService (Kotlin)"]
    L --> P["CaptureParser: amount, type, description, date"]
    P --> Q["NotificationCaptureQueue (journal, dedup by dedupKey)"]
    Q --> S{"Capture mode"}
    S -->|"auto"| I["Import as transaction"]
    S -->|"ask"| Prompt["Post import-prompt notification<br/>with income / debit / credit buttons"]
    Prompt --> R["CaptureActionReceiver"]
    R --> I
    I --> O["Encrypted SyncOutbox → WorkManager push"]
    O --> API["API /api/sync/push"]
    I -.->|"app open"| UI["Review inbox (/pending-review)"]
```

### 7.4 Receipt scanning (NFC-e)

Four capture paths exist: QR from camera, QR from picture, OCR from camera, OCR
from picture. QR is always attempted before OCR. Parsing never blocks on the
public portal: failures degrade to a review draft with missing fields.

```mermaid
flowchart LR
    Cam["Camera or picture"] --> Dec{"QR decodable?"}
    Dec -->|"yes (jsqr, client-side)"| QR["NFC-e QR payload (p=)"]
    Dec -->|"no"| OCR["tesseract.js OCR text (client-side)"]
    QR --> Scan["POST /api/receipts/scan"]
    OCR --> OcrEp["POST /api/receipts/ocr"]
    Scan --> Parse["receipt_scanner: parse p= payload<br/>access key, version, environment, offline total/date"]
    Parse --> Portal{"Complete HTTPS .gov.br URL?"}
    Portal -->|"yes"| Enrich["nfce_portal: best-effort DANFE fetch<br/>store, date, total, line items"]
    Portal -->|"no or failed"| Draft["Review draft (missing fields)"]
    Enrich --> Draft
    OcrEp --> Draft
    Draft --> Save["POST /api/receipts: persist store, receipt, items, price history"]
```

`fetch_details: false` forces QR-only parsing. Enforcement of the `p` parameter,
the four-path capture UX, and the portal's limits are recorded in
[ADR 011](adr/011-receipt-qr-camera-scanning.md).

## 8. Architecture decisions (ADR digest)

Full records live in [`docs/adr/`](adr/). Decision + why + main tradeoff:

| ADR | Decision | Why | Main tradeoff |
|---|---|---|---|
| 001 Rust + Axum | Rust/Tokio/Axum, SQLx, Lapin, `tracing` | Type safety, no GC, explicit nullability/errors | Slower builds and onboarding |
| 002 Code-first OpenAPI | `utoipa` → committed JSON → generated TS types | One shared schema set, no drift | Rust is the contract source; no design-first file |
| [003](adr/003-start-simple-single-entry.md) Simple first | Ship `transactions`, then add ledger postings | Early value; compatible rows | Two representations must stay consistent |
| [004](adr/004-budget-system-design.md) Budgets | Monthly per category/overall, read-time aggregation | Matches household budgeting; instantly consistent | Reports get costlier at high volume |
| [005](adr/005-ledger-design-and-event-sourcing.md) Ledger + events | Append-only `ledger_entries` + immutable `events` | Explicit accounting equation; durable replay | Must maintain both representations |
| [006](adr/006-isolation-level-choice.md) Isolation | `READ COMMITTED` per ledger transaction | Avoids retry cost without demonstrated need | Revisit if balances are materialized |
| [007](adr/007-event-publishing-via-rabbitmq.md) RabbitMQ | Durable fanout, persistent, confirm-less, best effort | Broker outage cannot block writes | Manual replay; consumers must rebind |
| [008](adr/008-reconciliation-design.md) Reconciliation | Amount + date matching (±1 day, 1-cent), user review | Predictable; no duplicate auto-creates | No fuzzy description matching |
| [009](adr/009-api-deprecation-strategy.md) Deprecation | Implicit v1; breaking changes at `/api/v2`; sunset headers | Clients can discover successors | Temporary double route/test surface |
| [010](adr/010-account-brand-icons.md) Account icons | Curated BR bank/instrument ids; monogram chips | Recognition without shipping logo assets | Clients must map ids; curated, not exhaustive |
| [011](adr/011-receipt-qr-camera-scanning.md) Receipt QR | Shared webview `getUserMedia` + `jsqr`; 4 capture paths | No native scanner plumbing; works on Android/browser | Needs camera permission + secure origin |
| [012](adr/012-category-icon-catalog.md) Category icons | ~110 grouped, i18n-labelled, searchable ids | Scales past 17 generic glyphs | Curated catalog, unknown ids fall back |

> Note: ADR 001 and 002 are tracked in git but currently deleted from the working
> tree. Restore them with
> `git checkout -- docs/adr/001-choose-rust-and-framework.md docs/adr/002-api-contract-strategy.md`
> if you need the full records; the standalone `docs/api-deprecation-policy.md`
> links to ADR 002.

## 9. API conventions

- **Base path**: unversioned `/api/...` is implicit v1. Additive changes stay on
  the current path; breaking changes go to `/api/v2/...`
  ([ADR 009](adr/009-api-deprecation-strategy.md)).
- **Auth**: `Authorization: Bearer <jwt>` required for every `/api/*` route
  except `/api/auth/*`. `/health` and `/metrics` are public by design.
- **Tokens**: access 15 min, refresh 7 days, HMAC-SHA256. The client refreshes
  once on 401 and retries. There is no rotation or revocation.
- **Errors**: JSON `{"error": "..."}`; internal details are logged via `tracing`,
  not returned.
- **Idempotency**: `transactions.idempotency_key` is unique when present, and the
  `idempotency_keys` table caches responses for 24 h.
- **Rate limiting**: in-memory fixed window per first `X-Forwarded-For`; 10
  writes/min for `/api/auth/login`, 120 writes/min otherwise; `429` on exceed.
- **Deprecation**: `/api/ledger/transactions` sends `Sunset: Sun, 01 Jan 2027`,
  `Deprecation: true`, and a `Link ... rel="successor-version"` header. This is a
  policy simulation — no `/api/v2` route exists yet.

Route groups (18 groups, 74 operations). The authoritative contract is
[`api/openapi/openapi.json`](../api/openapi/openapi.json); Swagger UI is served
at `/swagger-ui`.

| Group | Representative routes |
|---|---|
| Health | `GET /health`, `GET /metrics` |
| Auth | `POST /api/auth/register`, `/login`, `/google`, `/refresh`; `GET /api/auth/providers`, `/me` |
| Categories | `GET/POST /api/categories`, `GET/PUT/DELETE /api/categories/{id}` |
| Transactions | `GET/POST /api/transactions`, `GET/PUT/DELETE /api/transactions/{id}` |
| Accounts | `GET/POST /api/accounts`, `GET/PUT/DELETE /api/accounts/{id}`, `POST /api/accounts/{id}/adjust` |
| Summary | `GET /api/summary` |
| Budgets | `GET/POST /api/budgets`, `GET /api/budgets/summary`, `GET /api/budgets/alerts`, acknowledge routes, `DELETE /api/budgets/{id}` |
| Reports | `GET /api/reports/monthly`, `/cash-flow`, `/category-breakdown`, `/trends` |
| Ledger | `GET/POST /api/ledger/transactions`, `POST /api/migrate/single-to-double` |
| Reconciliation | `POST /api/reconciliation`, `/upload`; `GET /api/reconciliation/history` |
| Credit cards | `GET /api/credit-cards`, `/{id}`, `/{id}/bills`, `POST /{id}/purchases`, `/{id}/bills/{bill_id}/pay`, `/{id}/anticipate` |
| Installments | `GET/POST /api/installments`, `GET/DELETE /api/installments/{id}`, `/{id}/generate`, `/{id}/installment/{number}/pay` |
| Receipts | `POST /api/receipts/scan`, `/ocr`; `GET/POST /api/receipts`; `GET/DELETE /api/receipts/{id}`; `GET /api/receipts/stats`, `/price-history`; `PUT/DELETE /api/receipts/{id}/items/{item_id}`; `POST /api/receipts/product/merge` |
| Products | `GET /api/products`, `GET /api/products/{id}` |
| Stores | `GET /api/stores`, `GET /api/stores/{id}` |
| Sync | `POST /api/sync/pull`, `POST /api/sync/push` |
| Audit | `GET /api/audit/events` |
| Settings | `GET/PUT /api/settings` |

## 10. Client architecture

One codebase, three render targets. Shared state is composed in
`desktop/src/app/providers.tsx`: TanStack Query (30 s stale time, no refetch on
focus) → i18n → theme → toaster → auth → notification capture → `HashRouter`
(needed because Tauri loads the app from `file://`).

```mermaid
flowchart TD
    App["desktop/src (React)"] --> Shell["app/: providers, RootLayout, navigation, auth, i18n, theme"]
    App --> Features["features/: dashboard, transactions, accounts, budgets, receipts, ledger, reconciliation, audit, notifications, onboarding, biometric, diagnostics"]
    App --> Lib["lib/: api.ts (generated types), request.ts, auth.ts, serverConfig.ts, app-log.ts"]
    App --> Offline["offline/: database.ts, sync-engine.ts, sync-scheduler.ts, native-outbox.ts, net.ts"]
    App --> Notif["notifications/: capture.ts, native.ts, NotificationCaptureProvider.tsx"]
    Shell --> Tauri["src-tauri: auth_store (keyring/Keystore), oauth_loopback"]
    Notif --> Plugin["pudim-native plugin: capture, sync outbox, secure storage, biometrics, widgets, logs"]
```

- **Screens**: `/dashboard`, `/transactions`, `/accounts`, `/budgets` (+
  categories tab), `/receipts`, `/more`, and tool routes `/ledger`,
  `/reconciliation`, `/audit`, `/notifications`, `/pending-review`, `/server`,
  `/logs`. `/reports`, `/categories`, `/credit-cards` redirect to their new homes.
- **Server address is runtime config**: stored under `localStorage`
  (`pudim_server_url`), set on the login screen or **Settings → Server**, resolved
  as `VITE_API_BASE_URL ?? http://localhost:3000`. An explicitly empty
  `VITE_API_BASE_URL` means same-origin, which is what the nginx web image uses.
- **Token storage**: native keyring/Android Keystore through the Tauri
  `auth_store_*` commands, with a `localStorage` fallback (the only option in a
  plain browser).
- **Request layer** (`lib/request.ts`): 8 s default timeout, single-flight 401
  refresh with one retry, transport failures surfaced as `ApiError(status 0)` so
  the offline engine can distinguish "unreachable" from "rejected".
- **Offline engine**: IndexedDB `pudimfinance.db` holds `local_transactions`,
  `local_categories`, `local_accounts`, `pending_operations`, `sync_metadata`.
  Mutations queue locally and push/pull through `/api/sync/*`. Operations stop
  auto-retrying after `MAX_PUSH_ATTEMPTS = 3` but are never dropped until the user
  retries or discards them. The scheduler polls at 15 s while work is pending and
  60 s when idle, waking on `online`, `focus`, and `visibilitychange`.
- **Android native layer**: `NotificationListenerService` + `CaptureActionReceiver`
  + `CaptureParser` for bank alerts; `SyncOutbox` (encrypted) + `SyncWorker`
  (WorkManager) for closed-app pushes; `SecureStorage`; three widget sizes
  (4×2, 4×1, 2×1); camera (`CAMERA`) and `POST_NOTIFICATIONS` permissions are
  declared in the committed plugin manifest.
- **Diagnostics**: `/logs` merges a bounded in-WebView ring buffer (console
  wrapper, `window.onerror`, `unhandledrejection`, explicit `logEvent` calls, with
  tokens/passwords redacted) and native plugin logs read via `peek_logs`. It is the
  only way to debug a release build on a phone.

## 11. Development workflow

```bash
# Whole stack
cp .env.example .env
docker compose up --build

# Backend only (deps in Docker, API locally)
docker compose up -d postgres rabbitmq && cd backend && cargo run
./scripts/run.sh                      # or: start postgres + cargo run together

# Client
cd desktop && npm ci
npm run dev                           # Vite only, port 1420
npm run tauri dev                     # Tauri window with HMR
npm run tauri android build -- --target aarch64 --apk   # after android init
python3 ../scripts/android-release-setup.py             # release signing, cleartext policy

# Combined local checks (Docker-based)
./scripts/ci-checks.sh check
```

Targeted checks mirror CI:

```bash
cd backend
cargo fmt --check && cargo clippy -- -D warnings && cargo test --release
cargo run --bin gen-openapi > ../api/openapi/openapi.json   # then diff in CI

cd ../desktop
npm run lint && npm run typecheck && npm run build
npm run test:android && npm run test:widget && npm run test:qr-scan
npm run test:request-timeout && npm run test:offline   # offline test needs a running backend
npm run generate-types                                 # regenerate src/lib/api-types.ts
```

CI (`.github/workflows/`): **backend** runs fmt, clippy, generates OpenAPI and
**diffs it against the committed file**, builds, runs tests with live
PostgreSQL/RabbitMQ services, and runs `cargo audit`; **desktop** runs typecheck,
lint, the Node smoke tests, Tauri/Android/web builds, and Clippy for both the
Tauri core and the Android plugin.

## 12. Configuration and operations

All backend configuration is environment variables, read in
`backend/src/config.rs` (only `DATABASE_URL` is mandatory). Compose reads the
root `.env`; `scripts/run.sh` sources it for local runs.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `DATABASE_POOL_MAX_CONNECTIONS` | `10` | SQLx pool size |
| `DATABASE_POOL_ACQUIRE_TIMEOUT_SECS` | `10` | Pool acquisition timeout |
| `RABBITMQ_URL` | `amqp://pudim:pudim@localhost:5672` | Broker connection |
| `JWT_SECRET` | dev placeholder | JWT signing key (changing it invalidates sessions) |
| `GOOGLE_CLIENT_IDS` | empty (disabled) | Accepted public OAuth client IDs |
| `GOOGLE_CLIENT_SECRET_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | Desktop authorization-code exchange |
| `SERVER_HOST` / `SERVER_PORT` | `0.0.0.0` / `3000` | Bind address |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | Trace export |
| `RUST_LOG` | `backend=debug,tower_http=debug` | Log filter |
| `VITE_API_BASE_URL` | empty | Baked into the web build; empty = same-origin proxy |
| `*_PORT` (`WEB_PORT`, `PG_PORT`, `BACKEND_PORT`, …) | see Compose | Host port overrides |

- **Migrations** are applied automatically at startup by `sqlx::migrate!`. The
  schema lives in `backend/migrations/`: one consolidated
  `001_initial_schema.sql` plus `002_google_identity` and `003_account_icons`.
- **Backups**: `./scripts/backup.sh` writes a timestamped dump to `backups/`.
  Scheduling, retention, encryption, and restore testing are deployment
  responsibilities — see [`runbooks/db-recovery.md`](runbooks/db-recovery.md).
- **Observability**: `/metrics` exposes `pudim_ledger_transactions_total`,
  `pudim_ledger_event_publish_failures_total`, `pudim_db_pool_active_connections`,
  and `pudim_rabbitmq_connected`; Prometheus scrapes `backend:3000/metrics` and
  Grafana is provisioned from `infra/grafana-dashboard.json`. The repository ships
  **no** Alertmanager or blackbox exporter.
- **Failure behaviour**: PostgreSQL down ⇒ `/health` 503 and writes fail;
  RabbitMQ down ⇒ writes still succeed, `/health` reports `connecting`, publish
  failures increment a counter, and events remain in PostgreSQL for manual replay
  ([`runbooks/rabbitmq-recovery.md`](runbooks/rabbitmq-recovery.md)).
- **Targets, not guarantees**: [`slo.md`](slo.md), [`capacity-plan.md`](capacity-plan.md),
  and [`database-performance.md`](database-performance.md) contain targets and
  local observations only.

## 13. Known limitations and gotchas

These are the traps most likely to bite a new contributor or an automated agent:

- **RBAC is documented but not implemented.** `users.role` and the JWT `role`
  claim exist, and `docs/security/threat-model.md` plus the OpenAPI `Audit` tag
  describe admin-only access, but **no route or middleware checks the role**.
  `/api/audit/events` is intentionally readable by any authenticated user. Treat
  the auth model as authentication-only.
- **Single-tenant data model.** Financial tables have no `user_id`; every
  authenticated account shares one dataset.
- **Dual representation.** Every new transaction writes both a `transactions` row
  and balanced `ledger_entries`; keep the two consistent in any change.
- **Never edit an applied migration.** SQLx records checksums; add a new numbered
  migration instead. `001_initial_schema.sql` is a *consolidated* file: databases
  created by the older 001–014 migration set are explicitly not upgradeable.
- **Regenerate the contract and client types** whenever handler annotations
  change, or backend CI fails the OpenAPI diff:
  `cargo run --bin gen-openapi > ../api/openapi/openapi.json` then
  `npm run generate-types`.
- **Lint gates are strict.** `backend/src/lib.rs` sets `#![warn(missing_docs)]`
  and CI runs `cargo clippy -- -D warnings` plus `cargo fmt --check` for the
  backend, Tauri core, and Android plugin.
- **Root Docker build context** is required for the web image because the frontend
  imports `shared/` through `@shared`.
- **RabbitMQ has no automatic replay worker.** Recovering events published during
  an outage is a manual operational task over the `events` table.
- **Deprecation headers are a simulation** — there is no `/api/v2` yet.
- **Security posture is for LAN use, not the internet**: permissive CORS,
  in-memory (process-local) rate limiting, public `/metrics` and Swagger UI in
  Compose, browser tokens in `localStorage`, no token rotation/revocation, and a
  partial Terraform foundation. Harden before exposing beyond a trusted network —
  see [`security/threat-model.md`](security/threat-model.md).
- **Version skew to watch**: Compose pins `postgres:16` / `rabbitmq:3.13`, while
  backend CI exercises `postgres:18.6` / `rabbitmq:4.3.5`.
- **NFC-e portal enrichment is best-effort** and depends on external
  state-government HTML; QR-only payloads carry no store name or line items.
- **ADR 001 and 002 are currently deleted in the working tree** (tracked in git);
  `docs/api-deprecation-policy.md` links to the missing ADR 002.

## 14. Where to go deeper

| Topic | Document |
|---|---|
| Runtime diagrams (C4) | [`architecture-c4.md`](architecture-c4.md) |
| Tradeoff table | [`tradeoffs-summary.md`](tradeoffs-summary.md) |
| Decisions | [`adr/`](adr/) |
| Deployment, config, ports | [`runbooks/deployment.md`](runbooks/deployment.md) |
| PostgreSQL backup and recovery | [`runbooks/db-recovery.md`](runbooks/db-recovery.md) |
| RabbitMQ recovery and replay | [`runbooks/rabbitmq-recovery.md`](runbooks/rabbitmq-recovery.md) |
| Security controls and gaps | [`security/threat-model.md`](security/threat-model.md) |
| Service objectives | [`slo.md`](slo.md) |
| Capacity and bottlenecks | [`capacity-plan.md`](capacity-plan.md) |
| Query shapes and indexes | [`database-performance.md`](database-performance.md) |
| Failure simulations | [`dr-test.md`](dr-test.md) |
| API deprecation policy | [`api-deprecation-policy.md`](api-deprecation-policy.md) |
| AWS/Terraform scope | [`../infra/README.md`](../infra/README.md) |
| Client specifics (Android, logs) | [`../desktop/README.md`](../desktop/README.md) |
| Quickstart and prerequisites | [`../README.md`](../README.md) |
