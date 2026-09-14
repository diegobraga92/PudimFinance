# ADR 004: Budget System Design

**Status:** Accepted

**Date:** 2026-08-06

## Context

Layer 2 introduces monthly budgets per category, budget vs actual tracking, and spending reports. We need to decide:

1. The granularity of budgets (weekly vs monthly vs custom periods)
2. The create/update API model (separate endpoints vs single upsert)
3. How budget alerts are computed (event-driven vs on-read)
4. How reports are aggregated (materialized views vs direct SQL queries)

## Decision

### 1. Month-based budgets with per-category limits

Budgets are defined by `(category_id, month, year)` with a single `amount_limit` numeric value. A unique constraint on `(category_id, month, year)` ensures exactly one budget per category per month.

**Rationale:** Personal finance users naturally think in monthly terms (rent, salary, utilities). Weekly or custom-period budgets add complexity with little value at this stage. Monthly granularity also aligns with the existing `/api/summary` endpoint which already aggregates by month.

### 2. Upsert pattern via single `POST /api/budgets`

A single `POST /api/budgets` endpoint upserts a budget: creates if no budget exists for the `(category_id, month, year)` tuple, updates if one exists. This is implemented with `INSERT ... ON CONFLICT ... DO UPDATE`.

**Rationale:** Eliminates the need for separate create/update endpoints and avoids a client-side "does this exist yet?" check. Saves a round-trip and simplifies the web/mobile forms. The response includes a status code indicating whether the operation created (`201`) or updated (`200`) the budget.

### 3. Alerts computed on-read, not event-driven

The `budget_alerts` table exists in the initial schema, but the primary alert mechanism is the `GET /api/budgets/summary` endpoint which computes the percentage on every request. Client applications (web dashboard, mobile) check this endpoint and display warnings when spending reaches ≥80% of any budget.

**Rationale:** At Layer 2 scale (single user, personal finance), there is no need for a background worker or event pipeline to trigger alerts. Computing percentages at read time is trivially cheap (a few aggregate queries) and avoids eventual-consistency issues where an alert is stale. The `budget_alerts` table is preserved for future event-driven alerts in Layer 3 when RabbitMQ is introduced.

### 4. Reports via direct SQL aggregation

All report endpoints (`/api/reports/monthly`, `/api/reports/category-breakdown`, `/api/reports/trends`) use direct `GROUP BY` queries against the `transactions` table. No materialized views are used.

**Rationale:** Query complexity is low and transaction volume is small at this stage. Direct aggregation guarantees correct results without maintenance overhead of materialized views. If performance becomes an issue at scale, the existing `idx_transactions_date` index supports the aggregated queries well, and we can introduce materialized views in Layer 3/4.

## Consequences

- The `budgets` table enforces one budget per category per month via a UNIQUE constraint.
- Budgets only apply to expense categories — the backend validates this on `POST /api/budgets` and rejects income categories.
- The `budget_alerts` table is currently unused by application code but preserved for migration to event-driven alerts in Layer 3.
- The upsert API pattern is idempotent: calling `POST /api/budgets` twice with the same payload yields the same result.
- Reports are computed live from transactions; adding transactions immediately affects report output.
- A `DELETE /api/budgets/{id}` endpoint was added beyond the original Layer 2 plan to support full CRUD on mobile.

## Related ADRs

- ADR 003: Start with Simple Single-Entry Transactions (no change — budgets built against simple schema)
- ADR 002: API Contract Strategy (no change — new endpoints added to existing OpenAPI contract)