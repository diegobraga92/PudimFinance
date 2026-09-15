# PudimFinance client

The `desktop/` package contains the React frontend rendered by Tauri on desktop
and Android, and served by nginx for the browser build. Native capabilities live
in `src-tauri/`; shared translations and icon identifiers live in `../shared/`.

## Stack

- Tauri 2 and Rust
- React 18, TypeScript, Vite, Tailwind CSS
- TanStack Query, Zustand, React Router
- Radix primitives and Recharts
- IndexedDB offline mirror and sync queue
- Android plugin for notification capture, secure storage, biometrics, and widget support

## Development

```bash
cd desktop
npm ci
npm run dev
npm run tauri dev
```

The Vite server runs on port `1420`. The Tauri command requires the platform
dependencies documented by the [Tauri prerequisites](https://tauri.app/start/prerequisites/).
On Debian/Ubuntu, CI installs:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libgtk-3-dev libsoup-3.0-dev javascriptcoregtk-4.1-dev patchelf
```

## Android

```bash
npm run tauri android init
python3 ../scripts/android-release-setup.py
npm run tauri android build -- --target aarch64 --apk
```

`src-tauri/gen/android` is generated and ignored. The setup script injects
release signing, the optional cleartext-HTTP policy, and the Kotlin version
required by Credential Manager.

CI builds the arm64 APK with the same commands and publishes the
`pudimfinance-android-apk` artifact for main pushes and manual runs. See the
root [Android release instructions](../README.md#android-release-builds) for
signing secrets and OAuth configuration.

## Browser build

`desktop/Dockerfile.web` builds the frontend and `desktop/nginx.conf` serves it.
The Compose `web` service uses an empty `VITE_API_BASE_URL`, so nginx proxies
`/api`, `/health`, `/metrics`, `/swagger-ui`, and `/api-docs/` to `backend:3000`.

```bash
docker compose up --build web
```

To preview the static build without Docker:

```bash
npm run build
npm run preview -- --host
```

Browser mode uses `localStorage` for session persistence and disables native-only
features with a user-visible Android-only message.

## Generated API types

The source contract is `../api/openapi/openapi.json`. Regenerate the generated
TypeScript definitions after changing backend API annotations:

```bash
npm run generate-types
```

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm run test:offline
npm run test:android
```

`test:offline` uses `fake-indexeddb` and requires a reachable backend. The
Android smoke test server-side renders the shell and screens without a browser,
backend, or emulator.

Native Rust checks run separately:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings

cd plugins/pudim-android-native
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

## Source layout

```text
src/app/             providers, router, and application shell
src/components/      reusable UI and design-system primitives
src/features/        screen-specific components and state
src/notifications/   capture parser, inbox, provider, native bridge
src/offline/         IndexedDB mirror, connectivity probe, sync engine
src/lib/             API client, auth, server config, utilities
src-tauri/            Rust core and Android plugin
```

The OpenAPI-generated `src/lib/api-types.ts` file should be regenerated rather
than edited manually.