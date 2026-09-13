# 🏦 PudimFinance

> Personal finance application: Rust (Tokio + Axum) backend, Tauri 2 desktop + Android client, PostgreSQL.
> Built incrementally — a working transaction tracker first, with double-entry ledger, event sourcing, and RabbitMQ added in later layers.

**Tech Stack:** Rust (Tokio + Axum) backend · Tauri 2 (React/Vite) desktop + Android client · PostgreSQL

---

## Project Structure

```
PudimFinance/
├── backend/           # Rust + Axum API server
│   ├── src/routes/    # Categories, transactions, summary handlers
│   ├── src/models.rs  # SQLx/utoipa data models
│   └── migrations/    # PostgreSQL migrations (sqlx)
├── desktop/           # Tauri 2 client — one codebase for desktop + Android
│   ├── src/           # React + TypeScript + Vite frontend (design system, offline layer)
│   └── src-tauri/     # Rust core + pudim-android-native plugin (Android native)
├── api/
│   └── openapi/       # Generated OpenAPI 3.1 spec (from Rust utoipa annotations)
├── shared/            # i18n dictionaries + category icons shared with the client
├── infra/             # Terraform infrastructure-as-code (AWS)
├── docker-compose.yml # Local development environment (Postgres + Backend)
└── docs/
    ├── adr/           # Architecture Decision Records
    ├── DEV_PLAN.md    # Full development plan (all layers)
    └── slo.md         # Service Level Objectives
```

---

## Quickstart

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)
- [Rust](https://rustup.rs/) (1.78+) for the backend
- [Node.js](https://nodejs.org/) (20+) for the client
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for desktop builds
- Android SDK + NDK + JDK 17 for Android builds (CI runs these for you)

### Local Development (Docker)

```bash
# Start the backend stack (PostgreSQL, backend API)
docker compose up --build

# Services:
#   Backend API:  http://localhost:3000/health
#   Swagger UI:   http://localhost:3000/swagger-ui
```

> **Auth:** the API requires a JWT on every `/api/*` route except `/api/auth/*`.
> On first launch the client shows a registration form — create an account
> there and subsequent visits keep you signed in (tokens live in the OS
> keyring / Android Keystore, auto-refreshed for 7 days).

Running on a shared LAN server where Docker ports may conflict? See
[LAN Server Deployment](#lan-server-deployment).

### Backend (local, without Docker)

```bash
cd backend
cp ../.env.example .env
cargo run
```

### Desktop client (local)

See [`desktop/README.md`](desktop/README.md) for the full development and
verification guide.

```bash
cd desktop
npm install
npm run tauri dev      # Tauri window + HMR
```

> Linux desktop builds need the webkit2gtk dev libraries (see the desktop
> README); CI installs them automatically.

### Configuring the backend server (in-app)

The client's backend address is **configured at runtime** — not baked into the
bundle — so you can point the app at any PudimFinance server without rebuilding:

- **Login screen**: there is a "Server" field above the sign-in form. Enter
  your server's LAN address (e.g. `http://192.168.1.100:3000`) before signing
  in — it is saved automatically.
- **Already signed in**: open **Settings → Server** to view, change, test
  (`/health` ping) and save the address. Changes take effect immediately.
- If no address is configured, the app falls back to `http://localhost:3000`.

### Installing the Android app (CI-built APK)

The **Android** job in `.github/workflows/desktop-ci.yml` builds the app on
`main` pushes (or manually via **Run workflow**). The APK is uploaded as a
workflow artifact:

1. Open the **Actions** tab → select the **Android (tauri android build)** run.
2. Download the **Artifacts** and transfer the APK to your phone to install.

**Google Play Protect**: because the app is sideloaded, Play Protect may warn
or block the install. If it does, tap **"More details"** → **"Install
anyway"** (and re-enable Play Protect afterwards).

### Android: Push Notification Capture

The Android app can auto-capture transactions from bank/payment push
notifications (Nubank, Itaú, Banco do Brasil, PicPay, PIX, …):

1. Open **Settings → Notification Capture**.
2. Toggle **Auto-capture transactions** on and grant notification access
   (Settings → Special app access → Notification access).
3. Pick the apps to monitor (or leave empty to watch all) and choose a capture
   mode:
   - **Ask before creating** — captured transactions go to **Pending review**
     for you to confirm or edit.
   - **Auto-create** — transactions are saved immediately (toast confirms).
4. Optionally pick a **default category** used when the merchant can't be
   matched to an existing category.

In **Ask** mode, **Ask from a notification** (on by default) posts a heads-up
notification when a transaction is detected — e.g. *"Nubank transaction
detected: Compra aprovada — R$ 49,90"* — with three import actions:

- **Income** → creates an income transaction.
- **Debit** → creates an expense on the configured **Debit account**.
- **Credit** → creates an expense on the configured **Credit card**.

Tapping an action imports the transaction right away (no app open needed). If the
app process was killed, Android keeps the `NotificationListenerService` bound,
so it detects the amount, posts the prompt itself using a settings copy mirrored
to native storage, and stores the tap to apply on the next launch. Tapping the
notification body opens **Pending review**. Pick the debit and credit accounts in
the same settings screen; on Android 13+ you'll also be asked to allow
notifications so the prompt can appear.

The parser understands common Brazilian alert formats:

```
Compra aprovada R$ 49,90 em IFOOD        → expense 49.90 · IFOOD
Pix recebido R$ 500,00 de MARIA SANTOS   → income 500.00 · MARIA SANTOS
Cartão final 1234 R$ 100,00 às 14:30     → expense 100.00
Boleto pago R$ 85,75                     → expense 85.75
```

> **Android only.** Capture works by reading other apps' notifications through a
> native `NotificationListenerService` (the `pudim-android-native` Tauri
> plugin). It works while the app is backgrounded or killed (captured
> notifications are drained on the next launch). Desktop platforms have no
> equivalent OS API, so the feature shows an "Android only" notice there.

---

### Credit Cards, Faturas & Antecipação

Credit cards are `liability` accounts with a **closing day** (fatura fecha) and a
**due day** (vencimento). Card purchases are recorded as expenses dated at
purchase time — so they count in the month they're made — and post double-entry
ledger entries (debit expense, credit card), growing the card balance.

Each purchase is attached to the billing cycle it falls into, producing monthly
**bills** with computed totals and a payment deadline:

- `POST /api/credit-cards/{id}/purchases` — record a card purchase (expense + ledger + bill).
- `POST /api/credit-cards/{id}/bills/{bill_id}/pay` — pay a bill as a **transfer**
  (debit card, credit your bank account). Payments are never counted as expenses,
  so paying the card doesn't inflate monthly spending.
- `POST /api/credit-cards/{id}/anticipate` — **antecipar parcelas**: bring future
  installments (of plans linked to the card) onto the current bill, optionally
  with the discount the provider offers for early payment.

Installment plans accept an optional `account_id`, so their generated installments
land on the right card and become anticipatable.


---

## LAN Server Deployment

Running PudimFinance on a LAN server that already hosts other services in Docker
requires two things:

1. **No port conflicts** — the default host ports (`3000`, `5432`, `5672`,
   `15672`, `9090`, `3001`) may already be taken by other containers.
2. **A backend URL that works from other devices** — clients must reach the
   backend from the LAN (not from `localhost` on the server itself).

All host ports are configurable via environment variables, so you never need to
edit `docker-compose.yml`:

```bash
cp .env.docker .env.docker.local
$EDITOR .env.docker.local
```

```dotenv
PUBLIC_HOST=192.168.1.100   # this server's LAN IP (hostname -I)
BACKEND_PORT=3100           # if 3000 is taken
```

Then start and point each client at the backend:

```bash
docker compose --env-file .env.docker.local up --build -d
# Clients: Settings → Server → http://192.168.1.100:3100
```

If a firewall is enabled, allow the backend port:

```bash
sudo ufw allow 3100/tcp
```

### Configuration reference

| Variable | Default | Host port / role |
|----------|---------|------------------|
| `PUBLIC_HOST` | — | Server LAN IP/hostname (documentation only) |
| `JWT_SECRET` | `dev-secret-change-me-in-production` | Signs JWTs — override in production (`openssl rand -hex 32`); changing it signs everyone out |
| `PG_PORT` | `5432` | PostgreSQL |
| `RABBIT_PORT` | `5672` | RabbitMQ AMQP |
| `RABBIT_MGMT_PORT` | `15672` | RabbitMQ management UI |
| `BACKEND_PORT` | `3000` | Rust backend API |
| `PROMETHEUS_PORT` | `9090` | Prometheus |
| `GRAFANA_PORT` | `3001` | Grafana |

Internal container-to-container communication (`postgres:5432`, `backend:3000`,
`prometheus:9090`, ...) is unaffected — only host-facing ports are configurable.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (API + database status) |
| `GET` | `/api/categories` | List categories (filter by `?type=income\|expense`) |
| `POST` | `/api/categories` | Create category |
| `GET` | `/api/categories/{id}` | Get single category |
| `PUT` | `/api/categories/{id}` | Update category |
| `DELETE` | `/api/categories/{id}` | Delete category (409 if in use) |
| `GET` | `/api/accounts` | List chart-of-accounts with computed balances |
| `POST` | `/api/accounts` | Create account (asset/liability/equity/income/expense; liability = credit card when `closing_day`/`due_day` set) |
| `GET` | `/api/accounts/{id}` | Get single account with balance |
| `PUT` | `/api/accounts/{id}` | Update account |
| `DELETE` | `/api/accounts/{id}` | Delete account (409 if in use) |
| `GET` | `/api/credit-cards` | List credit cards with balances and current bill |
| `GET` | `/api/credit-cards/{id}` | Get a credit card with balance and current bill |
| `GET` | `/api/credit-cards/{id}/bills` | List billing cycles ("faturas") with computed totals |
| `POST` | `/api/credit-cards/{id}/purchases` | Record a card purchase (expense + ledger entries, attached to its bill) |
| `POST` | `/api/credit-cards/{id}/bills/{bill_id}/pay` | Pay a bill (transfer — never an expense) |
| `POST` | `/api/credit-cards/{id}/anticipate` | Anticipate future installments onto the current bill with an optional discount |
| `GET` | `/api/ledger/transactions` | List double-entry ledger transactions |
| `POST` | `/api/ledger/transactions` | Create balanced double-entry transaction |
| `POST` | `/api/migrate/single-to-double` | Migrate simple transactions to double-entry |
| `GET` | `/api/transactions` | Paginated list with filters (category, type, date range) |
| `POST` | `/api/transactions` | Create transaction (optionally split into 2-60 installments) — posts balanced ledger entries |
| `GET` | `/api/transactions/{id}` | Get single transaction |
| `PUT` | `/api/transactions/{id}` | Update transaction (re-posts its ledger entries) |
| `DELETE` | `/api/transactions/{id}` | Delete transaction (removes its ledger entries) |
| `GET` | `/api/summary` | Current month totals (income, expense, balance), grouped by category |
| `GET` | `/api/receipts` | List saved receipts (includes items + normalized product ids) |
| `POST` | `/api/receipts` | Save a parsed receipt |
| `POST` | `/api/receipts/scan` | Parse an NFC-e QR code into receipt data |
| `POST` | `/api/receipts/ocr` | Parse raw receipt text (OCR helper) |
| `GET` | `/api/receipts/price-history` | Price history for a normalized product |
| `POST` | `/api/receipts/product/merge` | Merge duplicate normalized products |
| `POST` | `/api/reconciliation` | Upload bank statement CSV for reconciliation |
| `POST` | `/api/reconciliation/upload` | Upload a bank statement file |
| `GET` | `/api/reconciliation/history` | List previous reconciliation runs |
| `GET` | `/api/audit/events` | List immutable audit events (admin-only) |
| `GET` | `/api/budgets` | List budgets for the current month |
| `POST` | `/api/budgets` | Create budget |
| `DELETE` | `/api/budgets/{id}` | Delete budget |
| `GET` | `/api/budgets/summary` | Budget spend vs limit for a month |
| `GET` | `/api/budgets/alerts` | List budget alerts (threshold crossings) |
| `POST` | `/api/budgets/alerts/{id}/acknowledge` | Acknowledge a single alert |
| `POST` | `/api/budgets/alerts/acknowledge-all` | Acknowledge all alerts |
| `GET` | `/api/reports/monthly` | Monthly income/expense report over a range |
| `GET` | `/api/reports/category-breakdown` | Category breakdown over a date range |
| `GET` | `/api/reports/trends` | Income/expense trend over N months |
| `POST` | `/api/sync/pull` | Pull changed rows for offline sync |
| `POST` | `/api/sync/push` | Push queued mutations for offline sync |
| `GET` | `/api/installments` | List installment plans with progress |
| `POST` | `/api/installments` | Create an installment plan |
| `GET` | `/api/installments/{id}` | Get plan detail (installments) |
| `POST` | `/api/installments/{id}/generate` | Lazily generate the plan's transactions |
| `POST` | `/api/installments/{id}/installment/{number}/pay` | Pay a single installment |
| `DELETE` | `/api/installments/{id}` | Delete an installment plan |

The full OpenAPI 3.1 spec is available at `http://localhost:3000/api-docs/openapi.json` and served via Swagger UI at `http://localhost:3000/swagger-ui`.

To regenerate the committed spec from Rust annotations:

```bash
cd backend && cargo run --bin gen-openapi > ../api/openapi/openapi.json
cd desktop && npm run generate-types   # regenerate TypeScript types
```

---

## Development Roadmap

| Layer | Focus | Status |
|-------|-------|--------|
| **Phase 0** | Project skeleton, health endpoint, CI/CD, ADRs | ✅ **Complete** |
| **Layer 1** | Simple income/expense tracking (categories + transactions) | ✅ **Complete** |
| **Layer 2** | Budgets, monthly reports, charts | ✅ **Complete** |
| **Layer 3** | Double-entry ledger, event sourcing, reconciliation | ✅ **Complete** |
| **Layer 4** | Observability, security, receipt scanner, docs | ✅ **Complete** |
| **Tauri** | Unified desktop + Android client (replaces web/ + mobile/) | ✅ **Complete** |

See [DEV_PLAN.md](docs/DEV_PLAN.md) for the complete roadmap.

---

## Key Design Decisions

All significant decisions are documented as Architecture Decision Records (ADRs) in [`docs/adr/`](docs/adr/).

| ADR | Title | Status |
|-----|-------|--------|
| 001 | [Choose Rust and Web Framework](docs/adr/001-choose-rust-and-framework.md) | ✅ Accepted |
| 002 | [API Contract Strategy](docs/adr/002-api-contract-strategy.md) | ✅ Accepted |
| 003 | [Start Simple Single-Entry Before Double-Entry](docs/adr/003-start-simple-single-entry.md) | ✅ Accepted |

---

## Operations

### Health Check

```bash
curl http://localhost:3000/health
# {"status":"ok","database":"connected","rabbitmq":"disabled","version":"0.1.0"}
```

### Metrics

```bash
curl http://localhost:3001/metrics
# Prometheus-format metrics
```

### Logging

Structured JSON logs with OpenTelemetry trace IDs:

```json
{"level":"INFO","message":"Server started","target":"backend","span":{"trace_id":"abc123"}}
```

### CI Checks

```bash
./scripts/ci-checks.sh check   # Full suite (backend fmt/clippy/audit/build, OpenAPI, desktop client)
```

---

## License

MIT
