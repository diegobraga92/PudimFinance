# RabbitMQ recovery runbook

RabbitMQ is a best-effort event transport. PostgreSQL commits and the audit event
row do not depend on a successful broker publish.

## Diagnose

```bash
curl -fsS http://localhost:3000/health | jq .rabbitmq
docker compose ps rabbitmq
docker compose logs backend rabbitmq | grep -i rabbitmq
```

The health response may report `connecting` while the backend retry loop is
waiting for the broker.

## Restart

```bash
docker compose restart rabbitmq
docker compose restart backend
docker compose ps rabbitmq
curl -fsS http://localhost:3000/health | jq .rabbitmq
```

The backend redeclares the durable `finance.ledger.transactions` fanout
exchange when it reconnects.

## Data and replay

Transactions created during a broker outage remain in PostgreSQL, including the
event payload. Messages that were not published are not automatically replayed by
the current application. A replay tool must read the relevant rows from `events`
and publish them to the exchange; review the consumer's idempotency behavior
before replaying.

## Checklist

- [ ] Health reports RabbitMQ as connected.
- [ ] The `finance.ledger.transactions` exchange exists and is durable/fanout.
- [ ] New ledger writes succeed and publish normally.
- [ ] Prometheus reports `pudim_rabbitmq_connected = 1`.
- [ ] Any outage interval requiring replay has been identified from the `events` table.