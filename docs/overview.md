# Overview

## General

PudimFinance is a self-hosted personal finance app. 
One React + TypeScript frontend is rendered three ways: Tauri on the desktop, Tauri on 
Android inside a WebView, and a static browser SPA served by nginx. 
Backend is Rust/Axum HTTP API with PostgreSQL and RabbitMQ.

PostgreSQL holds the money and the events. RabbitMQ is a fanout side channel for
whatever wants to subscribe, and nothing breaks when it is down. 
The client works offline first and reconciles through an outbox. 

Aimed to be single-user currently, but there is some groundwork to add more users in the future. 
Most of the finance logic follows Brazilian rules.

### Capabilities

- Income and expense transactions with categories and subcategories
- Accounts, balances, transfers, credit cards, card bills,
  installment plans, and installment anticipation
- Monthly budgets, denormalized alerts, cash-flow and category reports
- Double-entry ledger mirror, single→double migration, immutable audit events
- CSV/OFX bank-statement reconciliation with match history
- Brazilian NFC-e receipt scanning (QR and OCR, both from the camera or from a
  picture), with a best-effort fetch of public DANFE data, product normalization,
  and price history
- Android notification capture (bank alerts), biometric lock, and home-screen
  spending widgets
- Offline mirror (IndexedDB) with a queued, retrying mutation outbox

## Stack

| Layer | Technology |
|---|---|
| API | Rust, Axum, Tokio, Tower |
| Persistence | PostgreSQL via SQLx + migrations (`sqlx::migrate!`) |
| Events | RabbitMQ via `lapin`/`deadpool-lapin`. Durable fanout exchange `finance.ledger.transactions` |
| Auth | HS256 JWT access + refresh, Argon2id passwords, optional Google Sign-In |
| Client | React, TypeScript, Vite, Tailwind, TanStack Query, React Router (`HashRouter`), Radix primitives, Recharts |
| Native shell | Tauri (desktop + Android), Kotlin plugin `pudim-android-native` |
| Offline | IndexedDB mirror + `pending_operations` queue. Encrypted Android `SyncOutbox` + WorkManager |
| Receipt tooling | `jsqr` (client QR decode), `tesseract.js` (client OCR) |
| API contract | `utoipa` annotations, committed OpenAPI JSON, `openapi-typescript` types |
| Observability | Prometheus exporter, provisioned Grafana dashboard, `tracing` + OpenTelemetry/OTLP |
| CI | GitHub Actions: backend (fmt, clippy, OpenAPI diff, build, tests, `cargo audit`) and desktop (typecheck, lint, smoke tests, Tauri/Android/web builds) |

## System context

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

The supported deployment is one Docker Compose stack. Only the `web` service is a
client-facing container. The native clients talk to the backend directly.

| Service | Image (version might be outdated) | Host port (can be changed) | Role |
|---|---|---:|---|
| `postgres` | `postgres:16-alpine` | 5432 | Primary data store |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | 5672, 15672 | Event broker + management UI |
| `backend` | `backend/Dockerfile` | 3000 | API, migrations, metrics |
| `web` | `desktop/Dockerfile.web` | 5173 | Browser SPA + same-origin API proxy |
| `prometheus` | `prom/prometheus:v2.53.0` | 9090 | Metrics storage |
| `grafana` | `grafana/grafana:11.1.0` | 3001 | Provisioned dashboard |

The Terraform under `infra/` is a draft for now and does not deploy anything.

## Backend request pipeline

Middleware order matters and is set in `backend/src/main.rs`. Layers added later
wrap the ones added before them, so a request passes through them in this order,
outermost first: CORS, tracing, deprecation, rate limit, auth, then the handler.

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

Rate limiting sits before auth on purpose, so that login attempts are limited
too. `/health` returns 503 only when PostgreSQL is unreachable. RabbitMQ shows up
as `connected` or `connecting` and never fails the check on its own.

## Core data model

- `ledger_entries` is append-only. Each row has exactly one non-zero side
  (enforced by `chk_debit_or_credit`), and the debit and credit legs of a
  transaction have to cancel out. `backend/src/ledger.rs` checks that before the
  commit.
- `ledger_entries.transaction_id` is a grouping key, not a real foreign key. By
  convention it holds `transactions.id`. Older rows may instead be linked through
  `transactions.ledger_transaction_id`, and
  `transaction_ledger::delete_entries` copes with both cases.
- Every new transaction writes both representations: a `transactions` row and a
  balanced pair of `ledger_entries`.
- Posting accounts are resolved through a chain of fallbacks, so a missing link
  never fails the write. `resolve_posting_account` tries the explicit
  `categories.ledger_account_id` first, then an account whose name or type
  matches the category, then creates and links one, then falls back to a generic
  account (`Other Income` or `Miscellaneous`), and finally to any account of the
  required type. A stale `category_id` should degrade, never return a 500.
- `events` is immutable (`BIGSERIAL` key, JSONB payload). It is the durable record
  used for audit and manual replay, while RabbitMQ is only a side channel.
- Money is `NUMERIC(12,2)` and dates are `DATE`. Reports use half-open ranges
  (`>= start AND < end`) so the indexes still apply.
- Card dating is configurable. The SQL functions `card_bill_due_date` and
  `effective_transaction_date` implement the billing cycle and the
  `app_settings.card_expense_dating` choice between `purchase_date` and
  `due_date`.
- Budgets are upserted per `(category_id, month, year)`. The overall monthly
  budget is a row with `category_id IS NULL`, protected by its own partial unique
  index. Parent budgets include spending from their descendants, and overlapping
  ancestors are rejected.
- Stores are deduplicated by CNPJ when there is one, otherwise by `lower(name)`.
- `users` has a unique email, a nullable `password_hash` for Google-only accounts,
  and a unique `google_sub`. A check constraint requires at least one auth method.

## Key flows

### Transaction write, ledger, event, broker

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
    Note over H,RMQ: A publish failure is logged and counted but does not fail the write.<br/>The event stays queryable in PostgreSQL for manual replay
    H-->>C: 200/201 with transaction + ledger id
```

### Offline-first client sync

The client writes locally first and reconciles later. `POST /api/sync/push`
applies queued mutations, and `POST /api/sync/pull` returns everything that
changed since a timestamp. Transactions and categories come back by
`updated_at`/`created_at`. Accounts have no `updated_at`, so they are always
returned in full.

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
    Note over Native,API: WorkManager pushes the same ops while the app is closed.<br/>Results are reconciled (drain) on next open
```

### Android notification capture

Android only: A native `NotificationListenerService` watches bank
notifications, parses them, and either imports the result silently or posts a
prompt the user can act on.

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

### Receipt scanning (NFC-e)

There are four capture paths: QR from the camera, QR from a picture, OCR from the
camera, and OCR from a picture. Nothing waits on the public portal, so a lookup that 
fails still produces a review draft with the missing fields left empty.

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

`fetch_details: false` forces QR-only parsing.

## API conventions

The authoritative contract is [`api/openapi/openapi.json`](../api/openapi/openapi.json).
It is generated, never hand-edited: `backend/src/openapi.rs` derives the document
(OpenAPI 3.1) from the `utoipa` annotations on the handlers and models, and
`cargo run --bin gen-openapi` prints the JSON. Change the annotations and
regenerate, or backend CI fails the OpenAPI diff. The same document is served at
runtime as raw JSON at `/api-docs/openapi.json` and through Swagger UI at
`/swagger-ui`. `npm run generate-types` derives `desktop/src/lib/api-types.ts`
from the committed file.

## Client architecture

One codebase, three render targets. The provider stack lives in
`desktop/src/app/providers.tsx`, in this order: TanStack Query (30 s stale time,
no refetch on focus), i18n, theme, toaster, auth, notification capture, and
`HashRouter` (needed because Tauri loads the app from `file://`).

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
- **Android native layer**: `NotificationListenerService`, `CaptureActionReceiver`,
  and `CaptureParser` handle bank alerts. An encrypted `SyncOutbox` plus
  `SyncWorker` (WorkManager) pushes operations while the app is closed, and
  `SecureStorage` holds secrets. There are three widget sizes (4×2, 4×1, 2×1).
  The `CAMERA` and `POST_NOTIFICATIONS` permissions are declared in the committed
  plugin manifest.
- **Diagnostics**: `/logs` merges a bounded in-WebView ring buffer (console
  wrapper, `window.onerror`, `unhandledrejection`, explicit `logEvent` calls, with
  tokens/passwords redacted) and native plugin logs read via `peek_logs`. It is the
  only way to debug a release build on a phone.

## Development workflow

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

CI (`.github/workflows/`): **backend** runs fmt, clippy, generates the OpenAPI
document and **diffs it against the committed file**, builds, runs the tests
against live PostgreSQL and RabbitMQ services, and runs `cargo audit`. **desktop**
runs typecheck, lint, the Node smoke tests, the Tauri/Android/web builds, and
Clippy for both the Tauri core and the Android plugin.

## Configuration and operations

All backend configuration is environment variables, read in
`backend/src/config.rs` (only `DATABASE_URL` is mandatory). Compose reads the root
`.env`, and `scripts/run.sh` sources it for local runs.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | not set (required) | PostgreSQL connection string |
| `DATABASE_POOL_MAX_CONNECTIONS` | `10` | SQLx pool size |
| `DATABASE_POOL_ACQUIRE_TIMEOUT_SECS` | `10` | Pool acquisition timeout |
| `RABBITMQ_URL` | `amqp://pudim:pudim@localhost:5672` | Broker connection |
| `JWT_SECRET` | dev placeholder | JWT signing key (changing it invalidates sessions) |
| `GOOGLE_CLIENT_IDS` | empty (disabled) | Accepted public OAuth client IDs |
| `GOOGLE_CLIENT_SECRET_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | Desktop authorization-code exchange |
| `SERVER_HOST` / `SERVER_PORT` | `0.0.0.0` / `3000` | Bind address |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | Trace export |
| `RUST_LOG` | `backend=debug,tower_http=debug` | Log filter |
| `VITE_API_BASE_URL` | empty | Baked into the web build. An empty value means same-origin proxy |
| `*_PORT` (`WEB_PORT`, `PG_PORT`, `BACKEND_PORT`, …) | see Compose | Host port overrides |

- **Migrations** are applied automatically at startup by `sqlx::migrate!`. The
  schema lives in `backend/migrations/`.
- **Backups**: `./scripts/backup.sh` writes a timestamped dump to `backups/`.
  Scheduling, retention, encryption, and restore testing are left to the
  deployment.
- **Observability**: `/metrics` exposes `pudim_ledger_transactions_total`,
  `pudim_ledger_event_publish_failures_total`, `pudim_db_pool_active_connections`,
  and `pudim_rabbitmq_connected`. Prometheus scrapes `backend:3000/metrics`, and
  Grafana is provisioned from `infra/grafana-dashboard.json`. The repository ships
  **no** Alertmanager or blackbox exporter.
- **Failure behaviour**: when PostgreSQL is down, `/health` returns 503 and writes
  fail. When RabbitMQ is down, writes still succeed, `/health` reports
  `connecting`, publish failures bump a counter, and the events stay in PostgreSQL
  for manual replay.
