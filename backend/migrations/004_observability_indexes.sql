-- Layer 4 observability and performance improvements

-- Composite index for date-range and type filtering (the most common aggregation pattern)
CREATE INDEX IF NOT EXISTS idx_transactions_date_type ON transactions (date DESC, type);

-- Composite index for summary/report queries grouped by date
CREATE INDEX IF NOT EXISTS idx_transactions_date_only ON transactions (date DESC);

-- Composite index for ledger entry queries filtering by account and time range
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_date ON ledger_entries (account_id, recorded_at DESC);

-- Support index for reconciliation matching (amount and date)
CREATE INDEX IF NOT EXISTS idx_transactions_amount_date ON transactions (amount, date);
