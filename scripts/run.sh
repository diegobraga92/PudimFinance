#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[run]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[run]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[run]${NC} $1"; }
log_error() { echo -e "${RED}[run]${NC} $1"; }

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Start the PudimFinance development environment (PostgreSQL + backend).

The desktop client (Tauri) is started separately:

    cd desktop && npm install && npm run tauri dev

Options:
  --no-db    Skip starting Docker services (postgres)
  --clean    Remove Docker volumes and node_modules before starting
  --help     Show this help message and exit
EOF
    exit 0
}

cleanup() {
    echo ""
    log_info "Shutting down..."

    if [ -n "${BACKEND_PID:-}" ]; then
        log_info "Stopping backend (PID $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
        sleep 2
        kill -9 "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi

    pkill -9 -f "cargo run.*backend" 2>/dev/null || true

    if [ "${DOCKER_STARTED:-}" = "true" ]; then
        log_info "Stopping Docker services..."
        docker compose -f "$ROOT_DIR/docker-compose.yml" down
    fi

    log_ok "All services stopped. Goodbye!"
    exit 0
}

trap cleanup SIGINT SIGTERM

SKIP_DOCKER=false
CLEAN=false
for arg in "$@"; do
    case "$arg" in
        --no-db)  SKIP_DOCKER=true ;;
        --clean)  CLEAN=true ;;
        --help)   usage ;;
        *) log_warn "Unknown argument: $arg"; usage ;;
    esac
done

if [ "$CLEAN" = true ]; then
    log_info "Cleaning environment..."

    if docker compose -f "$ROOT_DIR/docker-compose.yml" ps --quiet 2>/dev/null | grep -q .; then
        log_info "Removing Docker containers and volumes..."
        docker compose -f "$ROOT_DIR/docker-compose.yml" down -v
    fi

    if [ -d "$ROOT_DIR/desktop/node_modules" ]; then
        log_info "Removing desktop/node_modules..."
        rm -rf "$ROOT_DIR/desktop/node_modules"
    fi

    log_ok "Clean complete."
fi

if [ "$SKIP_DOCKER" = false ]; then
    log_info "Starting Docker services (postgres)..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres
    DOCKER_STARTED=true

    log_info "Waiting for PostgreSQL to be healthy..."
    until docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
        pg_isready -U pudim -d pudimfinance >/dev/null 2>&1; do
        sleep 1
    done
    log_ok "PostgreSQL is healthy."
else
    log_info "Skipping Docker services (--no-db)."
fi

if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
    log_ok ".env loaded into environment."
else
    log_warn ".env file not found at $ROOT_DIR/.env — using defaults."
fi

log_info "Starting backend (cargo run)..."
(cd "$BACKEND_DIR" && cargo run) &
BACKEND_PID=$!
log_ok "Backend started (PID $BACKEND_PID)."

sleep 2

echo ""
log_ok "═══════════════════════════════════════════════════════════"
log_ok "  PudimFinance is running!"
log_ok ""
log_ok "  Backend API:  http://localhost:3000/health"
log_ok ""
log_ok "  Desktop client (separate terminal):"
log_ok "    cd desktop && npm install && npm run tauri dev"
log_ok ""
log_ok "  Press Ctrl+C to stop all services."
log_ok "═══════════════════════════════════════════════════════════"
echo ""

wait
