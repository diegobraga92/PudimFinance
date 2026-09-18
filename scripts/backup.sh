#!/usr/bin/env bash
# Creates a timestamped PostgreSQL dump.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p backups

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="backups/pudimfinance-${STAMP}.sql"

echo "Backing up pudimfinance → ${OUT}"

docker compose exec -T postgres pg_dump -U pudim -d pudimfinance > "${OUT}"

echo "Done: ${OUT} ($(du -h "${OUT}" | cut -f1))"