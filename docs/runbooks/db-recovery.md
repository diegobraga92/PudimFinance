# PostgreSQL recovery runbook

## Diagnose

```bash
curl -fsS http://localhost:3000/health | jq .database
docker compose ps postgres
docker compose logs backend | grep -i 'database\|error'
```

If the database is unavailable, stop writes until the storage state is known.

## Restart without data loss

```bash
docker compose restart postgres
docker compose ps postgres
curl -fsS http://localhost:3000/health | jq .
```

The Compose volume is preserved by a restart. Confirm the container is healthy
before restarting the backend if it does not reconnect automatically.

## Restore a SQL dump

Keep the current database volume until the dump is verified. For a disposable
restore environment:

```bash
docker compose stop backend
docker compose up -d postgres
cat backups/pudimfinance-<timestamp>.sql \
  | docker compose exec -T postgres psql -U pudim -d pudimfinance
docker compose up -d backend
curl -fsS http://localhost:3000/health | jq .
```

Replace `<timestamp>` with a file from the protected backup location. Do not
restore over a live production database without a tested change procedure.

## Verify

```bash
docker compose exec postgres psql -U pudim -d pudimfinance \
  -c 'SELECT COUNT(*) FROM transactions;'
docker compose exec postgres psql -U pudim -d pudimfinance \
  -c 'SELECT COUNT(*) FROM ledger_entries;'
curl -fsS http://localhost:3000/health | jq .
```

If legacy transactions have no ledger postings, an administrator can run the
idempotent migration endpoint after reviewing the data:

```bash
curl -fsS -X POST http://localhost:3000/api/migrate/single-to-double \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Point-in-time recovery

PITR is not configured by the Compose files or Terraform foundation. It requires
PostgreSQL WAL archiving, an archive destination, a base-backup procedure, and a
tested restore target. Treat the current backup script as dump-based recovery,
with RPO equal to backup age.