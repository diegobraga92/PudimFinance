# Runbook — Deployment

> How to deploy and operate the PudimFinance stack.
> Layer 4: Deployment.

---

## Prerequisites

- Docker + Docker Compose (v2)
- Ports available: 5432 (PG), 5672 (RMQ), 15672 (RMQ mgmt), 3000 (backend), 5173 (web), 9090 (Prometheus), 3001 (Grafana)

---

## Full Stack Startup

```bash
docker compose up -d --build
```

This starts, in order:
1. `postgres` (wait for healthy)
2. `rabbitmq` (wait for healthy)
3. `backend` (runs DB migrations on startup, connects RMQ)
4. `web` (nginx serving the `desktop/` frontend as a SPA, proxying `/api` + `/health` to the backend)
5. `prometheus` (scrapes backend:3000/metrics)
6. `grafana` (provisioned datasource + dashboard)

### Verify

```bash
# Health
curl -s http://localhost:3000/health | jq .
# Expect: {"status":"ok","database":"connected","rabbitmq":"connected",...}

# Web client (SPA shell served, same-origin API proxy)
curl -s http://localhost:5173 | grep -i 'id="root"'
curl -s http://localhost:5173/health | jq .

# Metrics
curl -s http://localhost:3000/metrics | grep pudim_

# Grafana (login admin/admin)
open http://localhost:3001
```

---

## First-Run Setup

After first start, a database is created with migrations. Register an admin user:

```bash
# Register a user (first user gets role 'user'; promote to admin manually if needed)
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123","display_name":"Admin"}'

# Promote to admin (via psql)
docker compose exec postgres psql -U pudim -d pudimfinance \
  -c "UPDATE users SET role='admin' WHERE email='admin@example.com';"
```

---

## Backup

Automated daily backups via `scripts/backup.sh`:
```bash
./scripts/backup.sh
```
This dumps `transactions`, `categories`, `budgets`, `ledger_entries`, `events`,
`stores`, `receipts` etc. into `backups/` with a timestamp.

---

## Shutdown

```bash
docker compose down          # stop containers (keep volume)
docker compose down -v       # destroy volume (DANGER: loses data)
```

---

## Scaling Notes

- Single instance is the target for this personal finance app.
- For higher scale: move PostgreSQL to managed RDS, RabbitMQ to managed broker,
  and run the backend behind a load balancer with multiple replicas.

---

## Environment Variables

| Variable | Default | Required |
|----------|---------|----------|
| `DATABASE_URL` | — | ✅ |
| `RABBITMQ_URL` | `amqp://pudim:pudim@localhost:5672` | — (falls back to log-only) |
| `JWT_SECRET` | `dev-secret-change-me-in-production` | ⚠️ Change in prod |
| `GOOGLE_CLIENT_IDS` | — | — (comma-separated Android/Desktop/server-audience OAuth client IDs) |
| `GOOGLE_CLIENT_SECRET_CLIENT_ID` | — | — (exact client ID paired with the confidential-client secret) |
| `GOOGLE_CLIENT_SECRET` | — | ⚠️ Set only in the ignored deployment `.env` when the Desktop client requires it |
| `SERVER_HOST` | `0.0.0.0` | — |
| `SERVER_PORT` | `3000` | — |
| `RUST_LOG` | `backend=debug,tower_http=debug` | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | — |
| `VITE_API_BASE_URL` | *empty* → same-origin via the nginx proxy | — (baked into the web bundle when the image is built) |
| `WEB_PORT` | `5173` | — (web client host port) |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Backend can't connect to DB | Ensure `postgres` is healthy: `docker compose ps`; check `DATABASE_URL` |
| Backend can't connect to RMQ | App still works (events skipped); `docker compose restart rabbitmq` |
| CORS errors in web | Serve the SPA through the `web` service (empty `VITE_API_BASE_URL` = same-origin nginx proxy). If the bundle was baked to an absolute URL, that origin must be reachable/allowed |
| Web client says the backend is unreachable | The `web` container resolves `backend` by service name: check `docker compose ps` and `curl http://localhost:5173/health` |
| Old SPA still on :5173 | Remove the pre-Tauri `web` container: `docker compose down --remove-orphans`, then `up --build` |
| Migrations fail | Run `docker compose exec backend /app/backend` once; check `backend/migrations/` |
| `/metrics` empty | Backend metrics recorder registered on startup; hit `curl localhost:3000/metrics` |