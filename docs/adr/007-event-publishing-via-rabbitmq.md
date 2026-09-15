# ADR 007: RabbitMQ event publishing

**Status:** Accepted
**Date:** 2026-08-06

## Decision

Publish ledger events to the durable fanout exchange
`finance.ledger.transactions` using persistent, confirm-less messages. The
backend retries exchange declaration while RabbitMQ is unavailable.

Database writes do not wait for successful publication. The PostgreSQL `events`
row is the durable record and RabbitMQ is the distribution mechanism.

## Rationale

Fanout lets independent consumers bind without routing-key coupling. At the
current scale, a broker round trip for publisher confirms is unnecessary; a
replay process can recover events from PostgreSQL.

## Consequences

- A broker outage does not block application writes.
- Consumers must bind to the exchange after deployment or broker recovery.
- The repository does not yet include an automatic outbox/replay worker; replay is an operational task.