# PudimFinance

Self-hosted personal finance application with a Rust/Axum API, PostgreSQL,
RabbitMQ, and a Tauri 2 client for desktop and Android. The same React frontend
can also be served as a browser application.

## Stack

- **Backend:** Rust, Tokio, Axum, SQLx, PostgreSQL
- **Events:** RabbitMQ fanout exchange; PostgreSQL remains the durable record
- **Client:** Tauri 2, React, TypeScript, Vite, Tailwind CSS
- **Offline mode:** IndexedDB mirror and queued mutations in the client
- **Observability:** Prometheus metrics, Grafana dashboard, structured tracing
- **API contract:** Rust `utoipa` annotations → committed OpenAPI JSON → generated TypeScript types

## Repository map

```text
backend/       Rust API, migrations, tests, and OpenAPI generator
desktop/       React/Tauri client and Android native plugin
shared/        Shared translations and icon identifiers
api/openapi/   Generated OpenAPI contract
infra/         Partial AWS/Terraform foundation
docs/          ADRs, runbooks, security, SLO, and operational notes
scripts/       Local development, CI, backup, load, and recovery helpers
```

## Quickstart with Docker Compose

### Prerequisites

- Docker and Docker Compose v2
- Node.js 20+ for client development
- Rust 1.78+ for backend development
- Tauri prerequisites for native desktop builds
- Android SDK, NDK, and JDK 17 for Android builds

### Start the stack

```bash
cp .env.example .env
docker compose up --build
```

Default endpoints:

| Service | URL |
|---|---|
| Browser client | http://localhost:5173 |
| Backend health | http://localhost:3000/health |
| OpenAPI JSON | http://localhost:3000/api-docs/openapi.json |
| Swagger UI | http://localhost:3000/swagger-ui |
| Prometheus metrics | http://localhost:3000/metrics |
| Grafana | http://localhost:3001 |

The API requires a JWT for `/api/*` routes except `/api/auth/*`. Register an
account from the client or through the authentication endpoints. Tokens use the
native keyring/Keystore in Tauri builds and `localStorage` in a browser.

### Google Sign-In

Google authentication is optional. Set `GOOGLE_CLIENT_IDS` in the ignored root
`.env`; use comma-separated Android, desktop, and server-audience client IDs.
For desktop authorization-code exchange, also set
`GOOGLE_CLIENT_SECRET_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the deployment
`.env` only. Android uses Credential Manager and does not need a client secret.

The Android OAuth client must be configured for package
`com.pudimfinance.app` and every APK signing certificate used by the build.
`desktop/google-oauth-clients.json` documents the client relationship.

## Local development

### Backend

Run PostgreSQL and RabbitMQ with Compose, then run the API locally:

```bash
cp .env.example .env
docker compose up -d postgres rabbitmq
cd backend
cargo run
```

Or use the helper, which starts the dependencies and backend together:

```bash
./scripts/run.sh
```

### Desktop client

See [`desktop/README.md`](desktop/README.md) for native prerequisites and
Android instructions.

```bash
cd desktop
npm ci
npm run dev          # frontend only
npm run tauri dev    # Tauri window with HMR
```

### Browser client

The browser build is the same frontend used by Tauri:

```bash
docker compose up --build web
```

For local iteration without Docker:

```bash
cd desktop
npm run build
npm run preview -- --host
```

An empty `VITE_API_BASE_URL` uses the nginx same-origin proxy. To bake a direct
backend URL into a browser build, set the variable during the build.

## Runtime server configuration

The client stores the backend address independently of the bundle:

- On the login screen, enter the server address before signing in.
- After login, use **Settings → Server** to view, test, and change it.
- For the Compose browser client, same-origin nginx routing requires no client-side server address.
- If unset, native clients use `VITE_API_BASE_URL` when present, otherwise `http://localhost:3000`.

For a LAN deployment, set `BACKEND_PORT`, `WEB_PORT`, and the other host-port
variables in `.env`, then configure native clients with the server's LAN address.
See [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md).

## Main features

- Income and expense transactions with categories and subcategories
- Accounts, balances, transfers, credit cards, bills, and installment plans
- Monthly budgets, alerts, and cash flow
- Double-entry ledger, migration from simple transactions, and audit events
- CSV/OFX reconciliation with match history
- NFC-e QR and OCR-text receipt parsing, product normalization, and price history
- Android notification capture, biometric lock, and spending overview widget (4×2 / 4×1 / 2×1)
- Offline transaction/category/account mirror with queued sync

## API contract

The committed contract is [`api/openapi/openapi.json`](api/openapi/openapi.json).
Do not maintain a second handwritten endpoint list: generate the contract from
the backend annotations and regenerate client types from that artifact.

```bash
cd backend
cargo run --bin gen-openapi > ../api/openapi/openapi.json

cd ../desktop
npm run generate-types
```

Backend CI compares generated OpenAPI output with the committed file. Desktop CI
typechecks and builds against the generated TypeScript definitions.

## Android release builds

The Android job in [`.github/workflows/desktop-ci.yml`](.github/workflows/desktop-ci.yml)
builds an arm64 APK and uploads the `pudimfinance-android-apk` artifact on main
pushes and manual workflow runs. Pull requests build the APK for validation but
do not publish it.

Release signing is configured by `scripts/android-release-setup.py` after
`tauri android init`. Configure the upload-keystore secrets for a release-signed
APK; without them CI uses the debug keystore and reports the fallback.

## Checks

Run the combined local checks:

```bash
./scripts/ci-checks.sh check
```

Useful targeted commands:

```bash
cd backend
cargo fmt --check
cargo clippy -- -D warnings
cargo test --release

cd ../desktop
npm run lint
npm run typecheck
npm run build
npm run test:offline      # requires a running backend
npm run test:android      # server-side UI smoke checks

# Android emulator build/install/launch + native notification smoke
../scripts/run-android.sh --smoke --keep
```

The Android runner uses the emulator loopback URL `http://10.0.2.2:3000` and
does not reset the database. Its `--smoke` mode fails unless the synthetic bank
notification produces a native capture prompt or `PudimSyncWorker` evidence.

## Operations and documentation

- [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md): Compose deployment and configuration
- [`docs/runbooks/db-recovery.md`](docs/runbooks/db-recovery.md): PostgreSQL recovery and backup restore
- [`docs/runbooks/rabbitmq-recovery.md`](docs/runbooks/rabbitmq-recovery.md): broker recovery and event replay
- [`docs/security/threat-model.md`](docs/security/threat-model.md): current security controls and gaps
- [`docs/slo.md`](docs/slo.md): service objectives and measurement status
- [`docs/adr/`](docs/adr/): accepted architecture decisions
- [`infra/README.md`](infra/README.md): scope and limitations of the AWS Terraform foundation

Back up the database with:

```bash
./scripts/backup.sh
```

The script writes timestamped dumps under `backups/`; protect that directory and
test restores regularly.

## License

MIT