# ADR 005: Ledger and event records

**Status:** Accepted
**Date:** 2026-08-06

## Decision

- `accounts` stores the chart of accounts.
- `ledger_entries` stores append-only debit/credit postings.
- A ledger transaction must balance before it is committed.
- `events` stores immutable `TransactionRecorded` payloads for audit and replay.
- Legacy simple transactions can be converted through the idempotent migration endpoint.

## Rationale

Append-only postings preserve financial history and make the accounting equation
explicit. The database event row is durable; RabbitMQ is a notification/fanout
side effect and is not the source of truth.

## Consequences

- Existing transaction/reporting routes remain available.
- New writes must maintain both the transaction and ledger representations.
- Event consumers can rebuild or process data from PostgreSQL if the broker is unavailable.
- Changes to ledger invariants require database and route-level tests.