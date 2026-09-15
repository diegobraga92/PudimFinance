# Disaster recovery test plan

These procedures exercise the local Docker Compose stack. They are simulations,
not evidence of a production RTO/RPO. Record actual timings when running them
against the target deployment.

## PostgreSQL container restart

```bash
docker compose stop postgres
curl -s http://localhost:3000/health | jq .database
docker compose up -d postgres
docker compose ps postgres
curl -s http://localhost:3000/health | jq .
```

Expected: the API reports a database outage while PostgreSQL is stopped, then
recovers after the health check passes. The named volume should preserve data.

## PostgreSQL volume loss

> **Destructive:** `docker compose down -v` deletes the local database volume.

```bash
./scripts/backup.sh
docker compose down -v
docker compose up -d --build
```

Restore a dump using the PostgreSQL recovery runbook and verify row counts and
health afterward. The RPO equals the age of the most recent usable backup.

## RabbitMQ outage

```bash
docker compose stop rabbitmq
curl -s http://localhost:3000/health | jq .rabbitmq
curl -s -X POST http://localhost:3000/api/transactions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"description":"DR test","amount":"1.00","type":"expense","date":"2026-01-01"}'
docker compose up -d rabbitmq
```

Expected: the database write succeeds, the health response reports the broker as
unavailable/connecting, and the exchange is redeclared after recovery. Events
published while the broker is down remain recoverable in PostgreSQL.

## Recovery checklist

- [ ] Health reports a connected database.
- [ ] Transaction and ledger row counts are plausible.
- [ ] RabbitMQ exchange exists and the connection gauge is `1`.
- [ ] A backup restore was tested, not only created.
- [ ] Client offline mutations converge after connectivity returns.