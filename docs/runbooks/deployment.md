# Deployment runbook

The supported deployment is Docker Compose on a host reachable by the clients.
The Terraform directory is a separate, incomplete AWS foundation; it does not
replace this runbook.

## Prerequisites

- Docker and Docker Compose v2
- Available host ports, or values configured in `.env`
- A persistent backup destination
- HTTPS/reverse-proxy controls before exposing the service to the internet

## Start

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
```

Compose starts PostgreSQL and RabbitMQ, then the backend, browser client,
Prometheus, and Grafana. Verify the services:

```bash
docker compose ps
curl -fsS http://localhost:3000/health | jq .
curl -fsS http://localhost:5173 | grep 'id="root"'
curl -fsS http://localhost:3000/metrics | grep pudim_
```

The default local ports are 3000 (backend), 5173 (web), 5432 (PostgreSQL),
5672/15672 (RabbitMQ), 9090 (Prometheus), and 3001 (Grafana). Set `BACKEND_PORT`,
`WEB_PORT`, `PG_PORT`, `RABBIT_PORT`, `RABBIT_MGMT_PORT`, `PROMETHEUS_PORT`, and
`GRAFANA_PORT` to avoid conflicts.

## First account

Register through the client or API:

```bash
curl -fsS -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"change-this-password"}'
```

The first registered user is not automatically an admin. Promote an account
only through a controlled database operation when admin access is required.

## Backups

Create a dump manually or from an external scheduler:

```bash
./scripts/backup.sh
```

The script writes `backups/pudimfinance-<timestamp>.sql`. Protect the directory,
apply retention/encryption outside the repository, and test restores with
[`docs/runbooks/db-recovery.md`](db-recovery.md).

## Shutdown and upgrade

```bash
docker compose down       # stop containers, preserve volumes
docker compose up -d --build
```

Do not use `docker compose down -v` unless the database volume is intentionally
being destroyed and a restore path has been verified.

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend cannot connect to PostgreSQL | `docker compose ps`; `DATABASE_URL`; PostgreSQL health logs |
| RabbitMQ unavailable | `docker compose logs rabbitmq backend`; writes should still commit |
| Browser cannot reach API | Use the Compose `web` service or verify `VITE_API_BASE_URL` was baked into the build |
| Port conflict | Set the host-port variables in `.env` |
| Migration failure | Inspect `docker compose logs backend` and `backend/migrations/` |
| Empty metrics | Query `http://localhost:3000/metrics`; Prometheus uses `backend:3000/metrics` internally |