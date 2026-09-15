# ADR 006: Ledger transaction isolation

**Status:** Accepted
**Date:** 2026-08-06

## Decision

Use PostgreSQL's default `READ COMMITTED` isolation for ledger writes inside a
single database transaction.

The account checks, idempotency handling, ledger inserts, and event insert must
commit or roll back together. PostgreSQL row locks and unique constraints handle
the current write conflicts.

## Rejected alternatives

- `SERIALIZABLE` would add retry behavior and cost without a demonstrated need.
- Advisory locks would add coordination for materialized balances that the current
  implementation does not maintain.

## Consequences

Ledger writes are atomic, but the design should be revisited if the application
adds materialized balances, concurrent account mutations, or a higher-volume
multi-tenant workload.