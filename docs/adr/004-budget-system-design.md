# ADR 004: Budget system

**Status:** Accepted
**Date:** 2026-08-06

## Decision

- Budgets are monthly and keyed by category, month, and year.
- An optional category ID represents the overall monthly limit.
- `POST /api/budgets` creates or updates the unique period/category row.
- Budget summaries aggregate current transaction data at read time.
- Reports use direct SQL aggregation rather than materialized views.

## Rationale

Monthly periods match common household budgeting. An upsert avoids a client-side
existence check, and read-time aggregation keeps the single-user deployment
simple and immediately consistent.

## Consequences

- Expense categories only can receive category budgets.
- Parent budgets include descendant spending and overlapping ancestor/descendant
  limits are rejected.
- Reports and budget summaries reflect new transactions without a refresh job.
- Materialized views or event-driven alerts can be introduced after profiling a larger workload.