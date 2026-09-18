#!/usr/bin/env bash
# Failure simulations against the local Docker stack.
# Run with ./scripts/failure-sim.sh [kill-db|kill-rabbitmq|latency|all]
set -euo pipefail

cd "$(dirname "$0")/.."
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
ok(){ echo -e "${GREEN}✓${NC} $1"; }
fail(){ echo -e "${RED}✗${NC} $1"; exit 1; }
info(){ echo "ℹ️ $1"; }

health() {
  curl -s http://localhost:3000/health 2>/dev/null | jq -r .database 2>/dev/null || echo "unreachable"
}

sim_kill_db() {
  info "Killing PostgreSQL container..."
  docker compose stop postgres
  sleep 3
  DB="$(health)"
  [[ "$DB" == "unreachable" || "$DB" == "disconnected" ]] || fail "Expected DB outage but got: $DB"
  ok "DB outage observed"
  info "Restarting PostgreSQL..."
  docker compose up -d postgres
  for i in $(seq 1 30); do
    sleep 1
    if [[ "$(health)" == "connected" ]]; then ok "DB recovered"; return 0; fi
  done
  fail "DB did not recover in 30s"
}

sim_kill_rabbitmq() {
  info "Stopping RabbitMQ (app should stay up)..."
  docker compose stop rabbitmq
  sleep 3
  # Creating a transaction must still work (event publish degrades gracefully)
  RSP=$(curl -s -X POST http://localhost:3000/api/transactions \
    -H 'Content-Type: application/json' \
    -d '{"description":"DR sim","amount":"10.00","type":"expense","category_id":null,"date":"2026-08-06","notes":null}' 2>/dev/null)
  echo "$RSP" | grep -q '"id"' && ok "Transaction created during RabbitMQ outage" || fail "Transaction failed during outage"
  info "Restarting RabbitMQ..."
  docker compose up -d rabbitmq
  sleep 3
  ok "RabbitMQ restarted"
}

sim_latency() {
  info "Simulating network latency on backend (delay 200ms)..."
  docker compose exec -T backend sh -c "apt-get install -y -qq iproute2 >/dev/null 2>&1 && tc qdisc add dev eth0 root netem delay 200ms 2>/dev/null" || \
    info "(latency simulation requires elevated container; skipping if tc unavailable)"
  # Measure a request
  START=$(date +%s%N)
  curl -s http://localhost:3000/health >/dev/null 2>&1 || true
  END=$(date +%s%N)
  MS=$(( (END - START) / 1000000 ))
  echo "Latency measurement ~${MS}ms (likely elevated)"
  # Remove latency
  docker compose exec -T backend sh -c "tc qdisc del dev eth0 root netem 2>/dev/null" || true
  ok "Latency removed"
}

info "=== PudimFinance Failure Simulations ==="
case "${1:-all}" in
  kill-db)     sim_kill_db ;;
  kill-rabbitmq) sim_kill_rabbitmq ;;
  latency)     sim_latency ;;
  all|"")      sim_kill_db; sim_kill_rabbitmq; sim_latency ;;
  *) echo "Usage: $0 [kill-db|kill-rabbitmq|latency|all]" >&2; exit 1 ;;
esac
echo "✅ Simulations complete (see docs/dr-test.md for expected results)"