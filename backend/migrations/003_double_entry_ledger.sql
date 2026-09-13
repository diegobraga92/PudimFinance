-- Layer 3 double-entry ledger, event sourcing, and idempotency

-- Chart of accounts
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
    parent_id UUID REFERENCES accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_type ON accounts (type);

-- Seed default chart of accounts (mirrors the Layer 1 seed categories)
INSERT INTO accounts (id, name, type) VALUES
    (gen_random_uuid(), 'Cash', 'asset'),
    (gen_random_uuid(), 'Bank Account', 'asset'),
    (gen_random_uuid(), 'Accounts Receivable', 'asset'),
    (gen_random_uuid(), 'Credit Card', 'liability'),
    (gen_random_uuid(), 'Salary Income', 'income'),
    (gen_random_uuid(), 'Freelance Income', 'income'),
    (gen_random_uuid(), 'Investment Income', 'income'),
    (gen_random_uuid(), 'Gifts Received', 'income'),
    (gen_random_uuid(), 'Other Income', 'income'),
    (gen_random_uuid(), 'Food & Groceries', 'expense'),
    (gen_random_uuid(), 'Housing', 'expense'),
    (gen_random_uuid(), 'Transportation', 'expense'),
    (gen_random_uuid(), 'Utilities', 'expense'),
    (gen_random_uuid(), 'Entertainment', 'expense'),
    (gen_random_uuid(), 'Healthcare', 'expense'),
    (gen_random_uuid(), 'Education', 'expense'),
    (gen_random_uuid(), 'Shopping', 'expense'),
    (gen_random_uuid(), 'Travel', 'expense'),
    (gen_random_uuid(), 'Subscriptions', 'expense'),
    (gen_random_uuid(), 'Insurance', 'expense'),
    (gen_random_uuid(), 'Gifts Given', 'expense'),
    (gen_random_uuid(), 'Miscellaneous', 'expense');

-- Immutable double-entry ledger
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id),
    debit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
    credit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
    description TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_debit_or_credit CHECK (
        (debit_amount = 0 AND credit_amount > 0) OR (debit_amount > 0 AND credit_amount = 0)
    )
);

CREATE INDEX idx_ledger_entries_transaction ON ledger_entries (transaction_id);
CREATE INDEX idx_ledger_entries_account ON ledger_entries (account_id);
CREATE INDEX idx_ledger_entries_date ON ledger_entries (recorded_at);

-- Event sourcing, an immutable event log
CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    aggregate_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_aggregate ON events (aggregate_id, aggregate_type);
CREATE INDEX idx_events_timestamp ON events (occurred_at);

-- Idempotency keys for duplicate request detection
CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    response_status INT NOT NULL,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys (expires_at);

-- Add idempotency_key column to simple transactions (NULL = not set)
ALTER TABLE transactions ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_transactions_idempotency ON transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Link simple transactions to their ledger transaction_id (NULL until migrated)
ALTER TABLE transactions ADD COLUMN ledger_transaction_id UUID;
CREATE INDEX idx_transactions_ledger ON transactions (ledger_transaction_id);

-- Reconciliation storage
CREATE TABLE reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_name TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_rows INT NOT NULL,
    matched_rows INT NOT NULL DEFAULT 0,
    unmatched_rows INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE TABLE reconciliation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reconciliation_id UUID NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
    statement_date DATE NOT NULL,
    statement_description TEXT NOT NULL,
    statement_amount NUMERIC(12, 2) NOT NULL,
    match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('matched', 'unmatched')),
    matched_transaction_id UUID,
    confidence NUMERIC(5, 2)
);

CREATE INDEX idx_reconciliation_items_recon ON reconciliation_items (reconciliation_id);