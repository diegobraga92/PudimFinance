# Database performance notes

These notes describe query shapes and indexes in the current schema. The timing
values are local observations, not production SLO evidence; benchmark the target
database and dataset before making capacity decisions.

## Relevant indexes

The initial migration defines indexes for:

- transaction dates and `(date, type)` filters;
- transaction amount/date reconciliation matching;
- ledger transaction, account/date, and recorded-at lookups; and
- category, budget, receipt, product, and reconciliation relationships.

Inspect the migration before adding another index:
`backend/migrations/001_initial_schema.sql`.

## Query considerations

### Date filtering

Use half-open ranges for date windows:

```sql
WHERE date >= $1 AND date < $2
```

This allows PostgreSQL to use the date indexes. Queries that apply
`EXTRACT(YEAR FROM date)` and `EXTRACT(MONTH FROM date)` in the predicate are
less index-friendly and should be profiled before use on large datasets.

### Transaction lists

The transaction list combines optional category/type/date filters with ordering
and pagination. Check the plan for the actual filter combination:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, description, amount, type, category_id, date, notes,
       created_at, updated_at
FROM transactions
WHERE date >= $1 AND date < $2
ORDER BY date DESC, created_at DESC
LIMIT 50 OFFSET 0;
```

### Reports

Monthly, category, cash-flow, and trend reports aggregate transaction rows at
read time. The current volume target is a personal installation; materialized
views or pre-aggregation should be considered only after profiling a real
workload.

### Reconciliation

The `(amount, date)` transaction index supports amount/date matching. Keep the
amount tolerance and date window aligned with the reconciliation parser and
validate plans after changing the matching query.

## Measurement

Use `EXPLAIN (ANALYZE, BUFFERS)` against a representative database. Track API
latency with the Prometheus/Grafana setup and use `scripts/load-test.js` for a
repeatable read-heavy smoke/load profile. Do not treat the local empty-database
timings in older project notes as service guarantees.