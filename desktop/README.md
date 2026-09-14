# PudimFinance Desktop (Tauri 2)

The unified PudimFinance client, replacing the previous `web/` (React SPA) and
`mobile/` (React Native) frontends. A single codebase targets both **desktop**
(Linux/macOS/Windows) and **Android** through Tauri 2. The UI is rebuilt from
scratch on a new design system — it does not reuse the legacy UI code, only the
shared non-visual modules (`shared/i18n`, `shared/category-icons`, the
OpenAPI-generated types).

## Stack

- **Shell**: Tauri 2 (Rust core + system webview) — desktop and Android
- **UI**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn-style Radix primitives
- **Data**: TanStack Query (server cache) + Zustand (client state) + React Router
- **Charts**: Recharts
- **Native (desktop)**: OS keyring (session tokens, `auth_store_*` commands)
- **Native (Android)**: `pudim-android-native` plugin — `NotificationListenerService`
  (bank push-notification capture), Android Keystore secure token storage,
  `BiometricPrompt` lock, and the home-screen Quick Add widget
- **Offline**: IndexedDB local mirror + sync engine (pending queue, pull/push,
  circuit breaker)

## Development

```bash
cd desktop
npm install
npm run dev            # Vite dev server on :1420 (frontend only)
npm run tauri dev      # Tauri window + HMR (requires Linux system deps, see below)
```

### Linux system dependencies (Tauri build)

```bash
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libgtk-3-dev libsoup-3.0-dev javascriptcoregtk-4.1-dev patchelf
```

### Android target

```bash
npm run tauri android init      # generates src-tauri/gen/android (gitignored)
npm run tauri android build     # needs Android SDK + NDK + JDK 17
```

CI (`.github/workflows/desktop-ci.yml`) builds the Android app on an
SDK-equipped runner (`tauri android init` + `tauri android build --target
aarch64 --apk`), signs it and uploads the APK as the `pudimfinance-android-apk`
workflow artifact. Signing is injected by `../scripts/android-signing.py`, which
writes `gen/android/keystore.properties` from the CI keystore secrets and patches
the generated `gen/android/app/build.gradle.kts` (both gitignored and re-created
by `android init`, so they cannot be committed); without a keystore secret the
release build falls back to the debug keystore. See the root
[README](../README.md#installing-the-android-app-ci-built-apk) for the secrets.

### Regenerating API types

```bash
npm run generate-types   # reads ../api/openapi/openapi.json → src/lib/api-types.ts
```

## Web client (LAN server)

The frontend doubles as a browser app: `desktop/Dockerfile.web` runs
`npm ci && npm run build` and serves the static bundle with
`desktop/nginx.conf`. The root `docker-compose.yml` wires it up as the `web`
service (`WEB_PORT`, default `5173`) — it replaces the retired `web/` React SPA.

- The bundle is built with an **empty** `VITE_API_BASE_URL`
  (`src/lib/serverConfig.ts` treats that as *same-origin*), and nginx proxies
  `/api`, `/health`, `/metrics`, `/swagger-ui` and `/api-docs/` to
  `backend:3000`, so a browser on the LAN needs no server configuration.
- Pass `VITE_API_BASE_URL=http://host:3000` as a build arg to bake direct API
  calls instead (rebuild required when the address changes).
- Browser-specific behaviour: `isTauri()` is false, so session tokens are kept
  in `localStorage` instead of the OS keyring and every native bridge
  (`src/notifications/native.ts`) no-ops, which makes the capture/biometric
  screens show their "Android only" notice.

```bash
# From the repo root
docker compose up --build web           # → http://localhost:5173

# Without Docker (uses the local dev backend on :3000)
npm run build && npm run preview -- --host
```

CI builds the image and smoke-tests the served SPA in the `web` job of
`.github/workflows/desktop-ci.yml`.

## Verification

```bash
npm run typecheck        # tsc -b
npm run build            # tsc -b && vite build
npm run tauri build      # full desktop bundle (deb/appimage/rpm on Linux)
npm run test:offline     # offline-first smoke tests (fake-indexeddb + live backend)
```

CI: `.github/workflows/desktop-ci.yml` runs typecheck, frontend build, Rust
clippy/rustfmt for the app and the plugin, the full `tauri build`, and the
Android build — which also signs and uploads the APK as the
`pudimfinance-android-apk` artifact.

## Layout

```
src/
├── app/                 # providers (i18n, theme, auth), router, shell (RootLayout)
├── components/ui/       # design-system primitives (button, card, dialog, ...)
├── features/            # one folder per screen (dashboard, transactions, ...)
├── notifications/       # capture parser/settings/inbox + native bridge + provider
├── offline/             # IndexedDB mirror, sync engine, connectivity probe
└── lib/                 # api-types.ts (generated), api.ts (typed client), auth, utils
src-tauri/               # Rust core + pudim-android-native plugin (Rust + Kotlin/Gradle)
```

## Migration status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Scaffold (Tauri 2 + React/Vite/TS, design system, shell, API client, CI) | ✅ |
| 2 | Design system + shell polish, i18n/theme | ✅ |
| 3 | Auth + server settings (keyring tokens) | ✅ |
| 4 | Core data (Transactions, Categories) | ✅ |
| 5 | Money (Accounts, Credit Cards) | ✅ |
| 6 | Insights (Budgets, Reports) | ✅ |
| 7 | Power tools (Ledger, Reconciliation, Receipts, Audit) | ✅ |
| 8 | Offline-first (IndexedDB mirror + sync engine) | ✅ |
| 9 | Notification capture (Android), onboarding, Android target + token storage | ✅ |
| 10 | Cutover (retire web/ + mobile/, Android CI) | ✅ |

## Backend fixes (pre-existing bugs found & fixed while validating)

- `transaction_ledger.rs` — `resolve_posting_account` decoded the nullable
  `categories.ledger_account_id` as a non-`Option<Uuid>` (sqlx `fetch_optional`
  already wraps in `Option`), so **creating any transaction with a category
  returned 500** ("unexpected null"). Fixed with
  `query_scalar::<_, Option<Uuid>>(...)` + `.flatten()`.
- `routes/transactions.rs` — `delete_transaction` didn't remove the
  `installment_transactions` FK rows, so **deleting an installment transaction
  returned 500**. Fixed by unlinking the schedule before the DELETE.

These were required to validate the new Transactions flow end-to-end.

## Notification capture (Android target)

The Android build reads other apps' bank notifications through a native
`NotificationListenerService` (the `pudim-android-native` Tauri plugin, ported
from the retired Expo module). The user grants **Notification access**
(Settings → Special app access → Notification access); notifications captured
while the app runs are streamed to the webview, and notifications captured
while it was killed are drained on the next launch. The parser/settings/inbox
live in `src/notifications/` (Settings → Notification Capture; ask mode queues
entries in **Pending review**). Desktop platforms have no equivalent OS API,
so those screens render an "Android only" notice there.

In ask mode, `NotificationCaptureProvider` also posts an import prompt through
the plugin (`show_capture_prompt`): a heads-up notification with **Income /
Debit / Credit** action buttons (`CapturePromptNotifier` +
`CaptureActionReceiver`). A tapped action is delivered live via the
`captureAction` event, or persisted in `PendingCaptureActions` and drained with
`drain_capture_actions` when the app was dead. Debit and credit expenses post to
the accounts chosen in the settings screen; the prompt is cancelled whenever the
capture is imported or skipped from the in-app inbox.

Because Android keeps a `NotificationListenerService` bound (and restarts it
after process death), the listener posts the prompt itself when the webview is
gone: `set_capture_settings` mirrors the settings to `CaptureSettingsStore`, the
listener resolves the source app's label via `PackageManager`, checks for an
amount, and embeds the raw notification in the action so the tap can be replayed
on the next launch. Drained notifications carry a `capture_id`/`prompted` flag so
each capture is only prompted once. (Foreground services can't help here — a
Tauri webview needs an Activity, so the JS parser can't run in the background.)

## Offline-first (Phase 8)

- `src/offline/database.ts` — IndexedDB mirror (transactions/categories/accounts),
  mutation queue and sync metadata. IndexedDB was chosen over a native SQLite
  module because it keeps the whole offline layer in TypeScript (zero native
  compile risk) while behaving identically in the Tauri webview and plain
  browser dev.
- `src/offline/net.ts` — circuit-breaker `/health` probe.
- `src/offline/sync-engine.ts` — push pending mutations, pull changed rows,
  single-flight sync, pending-count subscription.
- `src/lib/api.ts` — the CRUD functions are offline-first: when the server is
  unreachable they queue the mutation and update the mirror optimistically;
  reads fall back to the mirror.
- `src/components/OfflineBanner.tsx` — live offline/pending/syncing status.
- Validation: `npm run test:offline` (fake-indexeddb) exercises the real
  offline path against a live backend (offline create → sync → server, offline
  delete → sync → server).
