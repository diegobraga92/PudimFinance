#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
PASS="${GREEN}✅${NC}"
FAIL="${RED}❌${NC}"

DOCKER_RUN="docker run --rm -v $ROOT_DIR/backend:/app -w /app rust:slim-bookworm"
DEPS_CMD="apt-get update -qq && apt-get install -y -qq pkg-config libssl-dev curl > /dev/null 2>&1"

# Desktop Rust crates (Tauri core and Android plugin) need GTK/WebKit headers that
# the host may not have. Build a derived image with those packages baked in, then
# run Clippy in it as the host user with the host's rustup/cargo mounted, so the
# toolchain and build cache are shared (and no root-owned files land in the repo).
DESKTOP_RUST_IMAGE="pudimfinance-ci-desktop-rust:latest"
TAURI_DEPS="build-essential curl file git pkg-config libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev javascriptcoregtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev"
DESKTOP_RUST_RUN="docker run --rm --user $(id -u):$(id -g) -e CARGO_HOME=/cargo -e RUSTUP_HOME=/rustup -e HOME=/tmp -v $HOME/.cargo:/cargo -v $HOME/.rustup:/rustup -v $ROOT_DIR/desktop/src-tauri:/app -w /app $DESKTOP_RUST_IMAGE"

build_desktop_rust_image() {
    docker build -t "$DESKTOP_RUST_IMAGE" - > /dev/null <<EOF
FROM rust:slim-bookworm
RUN apt-get update -qq && apt-get install -y -qq $TAURI_DEPS > /dev/null 2>&1
EOF
}

step()   { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }
ok()     { echo -e "  ${PASS} $1"; }
fail()   { echo -e "  ${FAIL} $1"; exit 1; }
skip()   { echo -e "  ${YELLOW}⏭️  $1${NC}"; }

# ──────────────────────────────────────────────
# Backend checks run via Docker (cargo is not on the host)
# ──────────────────────────────────────────────
check_backend() {
    step "Backend: cargo fmt --check"
    $DOCKER_RUN \
        bash -c "rustup component add rustfmt > /dev/null 2>&1 && cargo fmt --check" \
        && ok "Format check passed" \
        || fail "Format check failed"

    step "Backend: cargo clippy -- -D warnings"
    $DOCKER_RUN \
        bash -c "$DEPS_CMD && rustup component add clippy > /dev/null 2>&1 && cargo clippy -- -D warnings" \
        && ok "Clippy passed" \
        || fail "Clippy found issues"

    step "Backend: cargo audit"
    $DOCKER_RUN \
        bash -c "$DEPS_CMD && cargo install cargo-audit --locked > /dev/null 2>&1 && cargo audit" \
        && ok "Security audit passed" \
        || fail "Security audit found vulnerabilities"

    step "Backend: cargo build"
    $DOCKER_RUN \
        bash -c "$DEPS_CMD && cargo build" \
        && ok "Build passed" \
        || fail "Build failed"

    step "Backend: Trivy container scan (HIGH/CRITICAL)"
    if command -v trivy > /dev/null 2>&1; then
        trivy image --severity HIGH,CRITICAL --exit-code 1 --ignore-unfixed \
            pudimfinance/backend:latest \
            && ok "Trivy scan passed" \
            || fail "Trivy found HIGH/CRITICAL CVEs"
    else
        skip "trivy not installed — skipping container scan"
    fi
}

# ──────────────────────────────────────────────
# Desktop client checks (npm available locally)
# ──────────────────────────────────────────────
check_desktop() {
    step "Desktop: npm install (if needed)"
    cd "$ROOT_DIR/desktop"
    if [ ! -d node_modules ]; then
        npm install --silent && ok "Dependencies installed" || fail "npm install failed"
    else
        ok "node_modules exists, skipping install"
    fi

    step "Desktop: lint"
    if npm run lint > /dev/null 2>&1; then
        ok "Lint passed"
    else
        echo ""
        npm run lint 2>&1 | grep -E "(error|Warning)"
        fail "Lint found errors"
    fi

    step "Desktop: typecheck"
    if npm run typecheck > /dev/null 2>&1; then
        ok "Typecheck passed"
    else
        fail "Typecheck failed"
    fi
}

# ──────────────────────────────────────────────
# OpenAPI checks
# ──────────────────────────────────────────────
check_openapi() {
    step "OpenAPI: spec validation"
    if npx --yes @redocly/cli lint "$ROOT_DIR/api/openapi/openapi.json" > /dev/null 2>&1; then
        ok "OpenAPI spec is valid"
    else
        npx @redocly/cli lint "$ROOT_DIR/api/openapi/openapi.json" 2>&1 | tail -n 30
        fail "OpenAPI spec validation failed"
    fi
}

# ──────────────────────────────────────────────
# Desktop Rust checks (Tauri core and Android plugin)
# ──────────────────────────────────────────────
check_desktop_rust() {
    step "Desktop Rust: prepare CI image"
    build_desktop_rust_image \
        && ok "Image ready ($DESKTOP_RUST_IMAGE)" \
        || fail "Failed to build $DESKTOP_RUST_IMAGE"

    step "Desktop Rust: cargo fmt --check (tauri core)"
    $DESKTOP_RUST_RUN bash -c "cargo fmt --check" \
        && ok "Rustfmt passed" \
        || fail "Rustfmt failed"

    step "Desktop Rust: cargo clippy --all-targets -- -D warnings (tauri core)"
    $DESKTOP_RUST_RUN \
        bash -c "cargo clippy --all-targets -- -D warnings" \
        && ok "Clippy passed" \
        || fail "Clippy found issues"

    step "Android plugin: cargo fmt --check"
    $DESKTOP_RUST_RUN \
        bash -c "cd plugins/pudim-android-native && cargo fmt --check" \
        && ok "Rustfmt passed" \
        || fail "Rustfmt failed"

    step "Android plugin: cargo clippy --all-targets -- -D warnings"
    $DESKTOP_RUST_RUN \
        bash -c "cd plugins/pudim-android-native && cargo clippy --all-targets -- -D warnings" \
        && ok "Clippy passed" \
        || fail "Clippy found issues"
}

usage() {
    echo "Usage: $(basename "$0") <command>"
    echo ""
    echo "Commands:"
    echo "  check                Run all CI checks (backend + rust + openapi + desktop)"
    echo "  check-backend        Backend only: fmt, clippy, audit, build"
    echo "  check-openapi        OpenAPI spec only: validation"
    echo "  check-desktop        Desktop client only: lint, typecheck"
    echo "  check-desktop-rust   Desktop Rust only: fmt, clippy (Tauri core + plugin)"
    echo ""
    echo "Examples:"
    echo "  ./scripts/ci-checks check-backend   # Check backend before push"
    echo "  ./scripts/ci-checks check           # Full check suite"
}

case "${1:-help}" in
    check)
        check_backend
        check_openapi
        check_desktop
        check_desktop_rust
        echo -e "\n${GREEN}═════════════════════════════════════${NC}"
        echo -e "${GREEN}  ✅ All checks passed!${NC}"
        echo -e "${GREEN}═════════════════════════════════════${NC}"
        ;;
    check-backend)
        check_backend
        echo -e "\n${GREEN}✅ Backend checks passed${NC}"
        ;;
    check-openapi)
        check_openapi
        echo -e "\n${GREEN}✅ OpenAPI checks passed${NC}"
        ;;
    check-desktop)
        check_desktop
        echo -e "\n${GREEN}✅ Desktop checks passed${NC}"
        ;;
    check-desktop-rust)
        check_desktop_rust
        echo -e "\n${GREEN}✅ Desktop Rust checks passed${NC}"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        echo -e "${FAIL} Unknown command: $1${NC}"
        usage
        exit 1
        ;;
esac