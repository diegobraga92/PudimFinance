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
# Start the full stack (PostgreSQL, RabbitMQ, backend API, web client)
docker compose up --build

# Services:
#   Web client:   http://localhost:5173
#   Backend API:  http://localhost:3000/health
#   Swagger UI:   http://localhost:3000/swagger-ui
```

> **Auth:** the API requires a JWT on every `/api/*` route except `/api/auth/*`.
> On first launch the client shows a registration form — create an account
> there and subsequent visits keep you signed in (tokens live in the OS
> keyring / Android Keystore; the web build falls back to `localStorage`, and
> every client auto-refreshes for 7 days).

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

### Web client (Docker)

The **same** React frontend the Tauri app renders can be served to any browser —
this is the supported replacement for the retired `web/` React SPA:

```bash
docker compose up --build web        # build + serve the SPA
# → open http://localhost:5173
```

- `desktop/Dockerfile.web` builds the frontend (`npm ci && npm run build`) and
  `desktop/nginx.conf` serves the static bundle, caching the hashed
  `/assets/*` forever and never caching `index.html`.
- The bundle is built with an **empty** `VITE_API_BASE_URL`, i.e. same-origin:
  nginx proxies `/api`, `/health`, `/metrics` and `/swagger-ui` to the backend,
  so **no per-browser server address is needed** (it also sidesteps CORS).
- To bake direct API calls instead, build with
  `VITE_API_BASE_URL=http://192.168.1.100:3000` (build arg, or the variable in
  `.env.docker`) — the client then calls that backend directly (CORS is
  permissive). This requires rebuilding the image when the address changes.
- Tauri-only features degrade gracefully in a browser: tokens fall back to
  `localStorage` (no OS keyring) and notification capture / biometrics / widget
  show the "Android only" notice.

Iterating on the web build without Docker:

```bash
cd desktop
npm run build && npm run preview -- --host   # static bundle, no Tauri APIs
# point it elsewhere with: VITE_API_BASE_URL=http://host:3000 npm run build
```

### Configuring the backend server (in-app)

The client's backend address is **configured at runtime** — not baked into the
bundle — so you can point the app at any PudimFinance server without rebuilding:

- **Login screen**: there is a "Server" field above the sign-in form. Enter
  your server's LAN address (e.g. `http://192.168.1.100:3000`) before signing
  in — it is saved automatically.
- **Already signed in**: open **Settings → Server** to view, change, test
  (`/health` ping) and save the address. Changes take effect immediately.
- **Web client** (served by `docker compose`, see [Web client](#web-client-docker)):
  the bundle is built for same-origin calls, so it needs no configuration — the
  nginx proxy reaches the backend automatically.
- If no address is configured, the app falls back to `VITE_API_BASE_URL` when it
  was baked into the bundle, otherwise `http://localhost:3000`.

### Installing the Android app (CI-built APK)

The **Android** job in `.github/workflows/desktop-ci.yml` builds *and publishes*
the app: it runs `tauri android init` + `tauri android build --target aarch64
--apk` on `main` pushes (or manually via **Run workflow**) and uploads the
signed APK as the **`pudimfinance-android-apk`** workflow artifact. Pull
requests build the APK too (so a broken Android build fails CI), but only `main`
and manual runs publish it.

1. Open the **Actions** tab → select the **Android (tauri android build)** run.
2. Download the **`pudimfinance-android-apk`** artifact (a zip containing
   `app-universal-release.apk`) and transfer the APK to your phone to install.

The artifact is arm64-v8a only (`--target aarch64`), which covers every recent
phone; x86_64 emulators need `--target x86_64` instead.

Release signing uses the upload keystore from the repository secrets, injected
by `scripts/android-release-setup.py` (the generated `src-tauri/gen/android`
project is gitignored, so the Gradle signing config cannot be committed):

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias upload
base64 -w0 upload-keystore.jks   # → secret ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 above |
| `ANDROID_KEY_ALIAS` | `upload` (the `-alias` used above) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_PASSWORD` | optional, only if the key password differs |

The legacy Expo names (`RELEASE_KEYSTORE_BASE64`, `RELEASE_KEY_ALIAS`,
`RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_PASSWORD`) are still accepted, so an
already-configured repository needs no changes. A distinct `ANDROID_KEY_PASSWORD`
only takes effect for a `-storetype JKS` keystore: `keytool` ignores `-keypass`
for PKCS#12 (the modern default), so there the store and key passwords must be
the same. When no keystore secret is set the workflow logs a warning and
debug-signs the release APK, so you still get an installable build.

The same script enables **cleartext HTTP** in release builds
(`android:usesCleartextTraffic="true"`). The Tauri template only allows it in
debug builds, so without this the OS rejects the `http://<lan-ip>:3000` servers
this client is designed for and the app reports *"Could not reach the server"* —
the web and desktop clients never hit it because they don't enforce the Android
network policy. Export `PUDIM_ALLOW_CLEARTEXT=false` in the step to keep
Android's secure default, in which case only `https://` servers can be reached.

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
purchase time and post double-entry ledger entries (debit expense, credit
card), growing the card balance.

Reporting is configurable: **Credit Cards → Card expense dating** decides whether
a card purchase counts in the month it was made (`purchase_date`, the default)
or in the month its bill is due (`due_date`; the `card_expense_dating` setting
behind `/api/settings`). The ledger always keeps the real purchase date — only
the dashboard, budgets, reports and the transaction list's date filters follow
the preference (see `effective_transaction_date` in
`backend/migrations/001_initial_schema.sql`).

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

### Budgets & Categories

The desktop client keeps **planning** and **organisation** on one screen
(`/budgets`), with two tabs — *Budgets* and *Categories* — plus a month selector
that deep-links (`/budgets?month=&year=`; the dashboard's "New budget" shortcut
adds `&add=1`). `/categories` redirects to `/budgets?tab=categories`.

**Category hierarchy.** `categories.parent_id` gives every
category an optional parent. The API keeps the tree valid
(`backend/src/routes/categories.rs`):

- a child must share its parent's type — income and expense branches never mix;
- a category cannot be moved under one of its own subcategories (cycles);
- changing the type of a category that still has subcategories is rejected;
- deleting a category is refused (`409`) while transactions reference it or
  subcategories depend on it.

**Budgets.** A budget row is either a *category budget* (`category_id` set) or the
*overall monthly budget* (`category_id IS NULL`, one per month via a partial
unique index). The overall limit is an independent "how much
can I spend this month?" figure; it does not need to match the sum of the
category limits, and the UI says so when it falls back to that sum.

A category's budget covers its **descendants**, so a parent limit counts
subcategory spending exactly once. To keep that unambiguous, a month cannot hold
overlapping limits: creating a budget for a category whose parent, child (or any
other ancestor/descendant) already has one returns `400`. Because limits are
resolved at read time, a category budget with no transactions still reports
`R$ 0,00 spent`, and moving a purchase between subcategories is reflected
immediately with no backfill.

`GET /api/budgets/summary` returns the category budgets in `items` (each with
`actual_spent`, `percentage` and `remaining`) plus the optional `overall` row,
whose `actual_spent` is the month's total spending. Percentages decide how the UI
colours each row: `< 80%` healthy, `80–99%` approaching the limit, `≥ 100%` over
budget — the same `80%` threshold the backend uses to raise alerts. Every figure
on the screen comes from the API; the client never re-derives spend.

---

### Tools — Reconciliation, Ledger & Audit Log

The accounting screens are one workspace, not three unrelated pages. **Tools** in
the header is a grouped menu (*Accounting & data* → Reconciliation, Ledger, Audit
Log; *Other tools* → Credit Cards; *Settings* → Server) and the three accounting
screens share a header plus three large tabs. The active tab is the route
(`/reconciliation`, `/ledger`, `/audit`), so every tool stays directly linkable and
the workspace never keeps a tab state that disagrees with the URL
(`desktop/src/features/tools/ToolsWorkspace.tsx`). No API behaviour changed.

**Reconciliation** (`/reconciliation`) answers one question: what matched? A
drag-and-drop zone accepts a CSV or OFX file (with the manual CSV paste kept
behind a toggle), the statement name is optional and "auto-create transactions for
unmatched rows" explains that unmatched rows become uncategorized expenses. The
result card shows *Imported / Matched / Need review / Created*, a matched
percentage bar, and the statement rows with their match badge, confidence and an
action per row — *View* opens the matched transaction (`GET /api/transactions/{id}`),
and an unmatched row links to the add-transaction form. The **Recent
reconciliations** card lists the stored history with a `Completed` / `N to
review` badge; row-level results exist only for the import in memory, so opening a
history entry shows the stored summary and says so.

**Ledger** (`/ledger`) is a read-only double-entry inspection surface for advanced
users — day-to-day money stays on Transactions. It lists Date, Description, Debit
account, Credit account, Amount and a per-entry balance mark, with a header
indicator ("Double-entry accounting · Balanced") computed from the rows on screen;
clicking a row opens the full entry list, both IDs and the recorded timestamp.
Search, account and date filters run client-side over the ledger payload. *New
Ledger Entry* records both sides at once (so an entry always balances), and
*Migrate single → double* is a secondary action behind a confirmation dialog that
reports the migration counts when it finishes.

**Audit Log** (`/audit`) is administrative. Non-admins get a single "Admin access
required" card instead of an empty table that looks like there was no activity.
Admins can filter by event type and date range — the filters the API supports
(`event_type`, `start_date`, `end_date`, `page`, `page_size`) — page through the
trail, and open any event's payload. Actor is shown only when the event carries
one; the event model has no actor column.

---

### Receipts, Items & Prices

Receipts are more than a scanner: every saved receipt feeds a personal price
database. The screen (`/receipts`) has five local tabs —
*Overview*, *Scan*, *Receipts*, *Items & Prices* and *Stores* — with the tab in
the URL (`?tab=scan`). Receipts now sits in the **primary** navigation, next to
Reports: it became a daily surface, so it left the Tools menu.

**Scanning.** An NFC-e QR code is parsed by the backend; a photo is read by
tesseract.js **in the client** and the extracted text is parsed by
`POST /api/receipts/ocr`, so both paths produce the same structure. Nothing is
stored until the review step: the parsed store, date, total and every line item
are editable, and `source` (`nfce` / `ocr`) is stored with the receipt — the
price-tracking screens badge it. Saving keeps the receipt's printed total; only
*item* edits recompute it (see below).

**Products and prices.** Items become normalized products (`normalized_products`)
and every item with a unit price is one price record. A product's history is its
records ordered by receipt date, so "latest" and "previous" are real purchases,
never interpolated values. The API returns `latest_price`, `previous_price`,
`change_percentage` (null when there is only one record — the UI then shows the
record count instead of "0%"), average, lowest, highest and the per-store
comparison (`GET /api/products/{id}`), including each store's own previous price
so the change is per store rather than global. Duplicate products are repaired
with `POST /api/receipts/product/merge` from the *Items & Prices* tab; the
backend stays the owner of product identity.

**Stores.** Stores are derived from receipts — never created by hand. Partial
unique indexes match a store by CNPJ, or by name when no CNPJ is known, so the
save path never inserts a duplicate. A store disappears when its last receipt is
deleted.
`GET /api/stores` accepts a period (`month`, `last_month`, `3m`, `6m`, `year`,
`all`) that scopes the aggregates; `GET /api/stores/{id}` returns the monthly
spend buckets, the most purchased items, the item prices recorded there and the
latest receipts.

**Receipt history vs price history.** The *Receipts* tab answers "what did I
buy?" (store, date, items, total, source, paging and filters) and the *Items &
Prices* tab answers "how much has this cost?" (latest, previous, change, then a
chart of actual prices, the purchases and where to buy it cheapest). The
two-way navigation is wired: a receipt item opens its product's history, and a
product's history lists the stores that sold it.

**Offline.** Receipts, products and price history are **not** in the offline
mirror: scanning, OCR parsing and price queries need the server. The screens show
an explicit "this feature needs a connection" message and a retry instead of
silently failing.

---

### Android shell & mobile layout

The client is one responsive React app; there is no separate Android build of the
UI. At the `md` breakpoint (768px — `useIsMobile` is not needed, everything is
CSS-driven) the composition switches:

| | Desktop (`≥ md`) | Phone (`< md`, Android) |
| --- | --- | --- |
| Navigation | top bar + grouped **Tools** menu | bottom tab bar: **Home · Transactions · Accounts · Budgets · More** |
| Screen header | page title + subtitle + actions | compact app bar (brand on tabs, back arrow + title elsewhere) |
| Primary action | header buttons | floating **+** on Home and Transactions |
| Dialogs | centred modal | bottom sheet, full width, safe-area padded |
| Tables | real tables | cards/lists under month headings |
| Touch targets | 32–36px controls | 44–48px buttons, inputs and select items |

`src/app/MobileTabBar.tsx` holds the five destinations, `src/app/MobileTopBar.tsx`
the app bar (brand on tabs, back arrow plus the screen title elsewhere, bell only
where notification capture exists), `src/app/QuickAddFab.tsx` the FAB (it reuses
the `?add=1` deep link) and `src/features/more/MorePage.tsx` the **More** tab,
which is where receipts, the accounting tools and settings moved so the bottom bar
stays at five entries. `src/app/navigation.ts` owns `MOBILE_TABS`, plus
`screenTitleKey()`/`isMobileRoot()` so the app bar title always matches the route.

Layout rules that apply everywhere: safe-area insets (`env(safe-area-inset-*)`)
on both the app bar and the tab bar, `viewport-fit=cover` in `index.html`, 16px
inputs so Android never zooms on focus, `overscroll-behavior` so the page does not
bounce behind the fixed tab bar, no tap highlight, and no horizontal scrolling
(tables become cards or scroll inside their own container).

Phone-specific compositions: the dashboard puts activity and budgets above the
charts and starts with a compact greeting instead of a 28px title; Transactions
gets type chips, a collapsible filter panel and a month-grouped list
(`features/transactions/group-by-month.ts`); Accounts gets full-width scrollable
chips; Receipts gets two large capture shortcuts (QR / photo); Reconciliation
becomes a three-step wizard (**Upload → Match → Review**, each step a tappable
chip, with per-row cards); Audit Log uses expandable event cards with the raw
payload inline; and the Ledger shows the same table data as stacked rows with its
filters wrapping.

`npm run test:android` server-side renders the shell, the More tab, the primary
screens and the accounting tools, then asserts the navigation model and the month
grouping — no backend or browser needed.

---

## LAN Server Deployment

Running PudimFinance on a LAN server that already hosts other services in Docker
requires two things:

1. **No port conflicts** — the default host ports (`3000`, `5173`, `5432`,
   `5672`, `15672`, `9090`, `3001`) may already be taken by other containers.
2. **Addresses that work from other devices** — desktop/Android clients must
   reach the backend from the LAN (not `localhost` on the server itself), while
   the web client is served same-origin so it needs no address at all.

All host ports are configurable via environment variables, so you never need to
edit `docker-compose.yml`:

```bash
cp .env.docker .env.docker.local
$EDITOR .env.docker.local
```

```dotenv
PUBLIC_HOST=192.168.1.100   # this server's LAN IP (hostname -I)
BACKEND_PORT=3100           # if 3000 is taken
WEB_PORT=5180               # if 5173 is taken
VITE_API_BASE_URL=          # empty = same-origin (recommended)
```

Then start and open the clients:

```bash
docker compose --env-file .env.docker.local up --build -d
# Web UI:  http://192.168.1.100:5180
# Apps:    Settings → Server → http://192.168.1.100:3100
```

If a firewall is enabled, allow the web and backend ports:

```bash
sudo ufw allow 5180/tcp
sudo ufw allow 3100/tcp
```

### Replacing the retired Web UI

Before the Tauri migration the stack shipped a separate `web/` service (the old
React SPA) on the same port. The current `docker-compose.yml` builds the client
from `desktop/` instead, so clean up the leftovers once:

```bash
# 1) Stop everything, including containers whose service no longer exists
#    (this is the old `web` container still holding the port).
docker compose down --remove-orphans

# 2) Pull the current repo (compose + desktop/Dockerfile.web + desktop/nginx.conf).
git pull

# 3) Start again — this builds the new `web` image from desktop/.
docker compose --env-file .env.docker.local up --build -d

# 4) Optional: drop the now-dangling old web image.
docker image prune -f
```

Verify the port serves the new client (dark theme, hash routes such as
`/#/transactions`) and that the same-origin API proxy works:

```bash
curl -s http://localhost:5173 | grep -i 'id="root"'
curl -s http://localhost:5173/health | jq .
```

If you kept a separate checkout of the old `web/` app, delete that directory
afterwards — nothing in this repo references it anymore.

### Configuration reference

| Variable | Default | Host port / role |
|----------|---------|------------------|
| `PUBLIC_HOST` | — | Server LAN IP/hostname (documentation only) |
| `JWT_SECRET` | `dev-secret-change-me-in-production` | Signs JWTs — override in production (`openssl rand -hex 32`); changing it signs everyone out |
| `WEB_PORT` | `5173` | Web client (SPA behind nginx) — see [Web client](#web-client-docker) |
| `VITE_API_BASE_URL` | *(empty)* | Web client API origin, baked at image build time; empty = same-origin via the nginx proxy |
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
| `POST` | `/api/categories` | Create category (parent must share the type) |
| `GET` | `/api/categories/{id}` | Get single category |
| `PUT` | `/api/categories/{id}` | Update category (`400` on cycles or mixed-type branches) |
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
| `GET` | `/api/receipts` | List receipts (search, store, date range, min/max total, source, paging) |
| `POST` | `/api/receipts` | Save a reviewed receipt (`source`: `nfce` \| `ocr`) |
| `GET` | `/api/receipts/{id}` | Receipt with its items |
| `DELETE` | `/api/receipts/{id}` | Delete a receipt (plus any store/product left without records) |
| `PUT` | `/api/receipts/{id}/items/{item_id}` | Edit an item; the receipt total is recomputed |
| `DELETE` | `/api/receipts/{id}/items/{item_id}` | Delete an item; the receipt total is recomputed |
| `POST` | `/api/receipts/scan` | Parse an NFC-e QR code into receipt data |
| `POST` | `/api/receipts/ocr` | Parse raw receipt text (OCR helper) |
| `GET` | `/api/receipts/stats` | Overview numbers (receipts, spend, items tracked, stores) |
| `GET` | `/api/receipts/price-history` | Price history for a normalized product (legacy shape) |
| `POST` | `/api/receipts/product/merge` | Merge duplicate normalized products |
| `GET` | `/api/products` | Products with price statistics (`change`, `sort`, paging) |
| `GET` | `/api/products/{id}` | Price history, every record and the per-store comparison |
| `GET` | `/api/stores` | Stores with receipt aggregates (`period`, `sort`, paging) |
| `GET` | `/api/stores/{id}` | Store detail (monthly spend, top items, item prices, receipts) |
| `POST` | `/api/reconciliation` | Upload bank statement CSV for reconciliation |
| `POST` | `/api/reconciliation/upload` | Upload a bank statement file |
| `GET` | `/api/reconciliation/history` | List previous reconciliation runs |
| `GET` | `/api/audit/events` | List immutable audit events (admin-only) |
| `GET` | `/api/budgets` | List budgets for a month (includes the overall budget) |
| `POST` | `/api/budgets` | Create/update a budget (omit `category_id` for the overall budget; `400` on overlapping parent/child limits) |
| `DELETE` | `/api/budgets/{id}` | Delete budget |
| `GET` | `/api/budgets/summary` | Budget spend vs limit for a month (category `items` + optional `overall`; parent budgets include descendant spend) |
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
| `GET` | `/api/settings` | Read application preferences (`card_expense_dating`) |
| `PUT` | `/api/settings` | Update application preferences |

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
