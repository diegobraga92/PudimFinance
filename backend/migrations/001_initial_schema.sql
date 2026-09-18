-- PudimFinance initial schema.
--
-- Single consolidated migration for a fresh database: every table, index,
-- constraint, function and seed row the application needs. Databases created by
-- the previous 001-014 migration set are not upgradeable; recreate them.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
    account_kind TEXT NOT NULL DEFAULT 'other',
    parent_id UUID REFERENCES accounts(id),
    closing_day SMALLINT CHECK (closing_day IS NULL OR (closing_day BETWEEN 1 AND 31)),
    due_day SMALLINT CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31)),
    credit_limit NUMERIC(12, 2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_type ON accounts (type);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    icon TEXT,
    color TEXT,
    ledger_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX idx_categories_type ON categories (type);
CREATE INDEX idx_categories_parent ON categories (parent_id);

INSERT INTO accounts (name, type, account_kind) VALUES
    ('Cash', 'asset', 'cash'),
    ('Bank Account', 'asset', 'bank'),
    ('Accounts Receivable', 'asset', 'other'),
    ('Credit Card', 'liability', 'loan'),
    ('Salary Income', 'income', 'income'),
    ('Freelance Income', 'income', 'income'),
    ('Investment Income', 'income', 'income'),
    ('Gifts Received', 'income', 'income'),
    ('Other Income', 'income', 'income'),
    ('Food & Groceries', 'expense', 'expense'),
    ('Housing', 'expense', 'expense'),
    ('Transportation', 'expense', 'expense'),
    ('Utilities', 'expense', 'expense'),
    ('Entertainment', 'expense', 'expense'),
    ('Healthcare', 'expense', 'expense'),
    ('Education', 'expense', 'expense'),
    ('Shopping', 'expense', 'expense'),
    ('Travel', 'expense', 'expense'),
    ('Subscriptions', 'expense', 'expense'),
    ('Insurance', 'expense', 'expense'),
    ('Gifts Given', 'expense', 'expense'),
    ('Miscellaneous', 'expense', 'expense');

INSERT INTO categories (name, type, icon, color) VALUES
    ('Salary', 'income', 'briefcase', '#22c55e'),
    ('Freelance', 'income', 'laptop', '#16a34a'),
    ('Investments', 'income', 'trending-up', '#15803d'),
    ('Gifts Received', 'income', 'gift', '#a3e635'),
    ('Other Income', 'income', 'plus-circle', '#86efac'),
    ('Food & Groceries', 'expense', 'shopping-cart', '#ef4444'),
    ('Housing', 'expense', 'home', '#dc2626'),
    ('Transportation', 'expense', 'car', '#b91c1c'),
    ('Utilities', 'expense', 'zap', '#f97316'),
    ('Entertainment', 'expense', 'film', '#eab308'),
    ('Healthcare', 'expense', 'heart', '#ec4899'),
    ('Education', 'expense', 'book', '#8b5cf6'),
    ('Shopping', 'expense', 'shopping-bag', '#6366f1'),
    ('Travel', 'expense', 'plane', '#3b82f6'),
    ('Subscriptions', 'expense', 'repeat', '#06b6d4'),
    ('Insurance', 'expense', 'shield', '#14b8a6'),
    ('Gifts Given', 'expense', 'gift', '#84cc16'),
    ('Miscellaneous', 'expense', 'more-horizontal', '#6b7280');

-- Point each seeded category at its income/expense posting account.
UPDATE categories c
SET ledger_account_id = a.id
FROM accounts a
WHERE a.type = c.type
  AND (
      a.name = c.name
      OR (c.name = 'Salary' AND a.name = 'Salary Income')
      OR (c.name = 'Freelance' AND a.name = 'Freelance Income')
      OR (c.name = 'Investments' AND a.name = 'Investment Income')
  );

-- ---------------------------------------------------------------------------
-- Transactions, installments and card bills
-- ---------------------------------------------------------------------------

-- Declared before transactions and installment_transactions, which reference it.
CREATE TABLE installment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
    installments INT NOT NULL CHECK (installments >= 2 AND installments <= 60),
    installment_amount NUMERIC(12, 2) NOT NULL CHECK (installment_amount >= 0),
    category_id UUID REFERENCES categories(id),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_installment_plans_start ON installment_plans (start_date);
CREATE INDEX idx_installment_plans_category ON installment_plans (category_id);
CREATE INDEX idx_installment_plans_account ON installment_plans (account_id);

-- Card billing cycles ("faturas"), one row per card per closing date. Totals are
-- computed on read from the card's transactions; only settlement is persisted.
-- Declared before installment_transactions, which references it.
CREATE TABLE card_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (card_id, period_end)
);

CREATE INDEX idx_card_bills_due ON card_bills (due_date);

-- Every transaction is mirrored into a balanced ledger_entries pair at write
-- time (backend/src/transaction_ledger.rs), with ledger_transaction_id = id.
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    installment_plan_id UUID REFERENCES installment_plans(id),
    idempotency_key TEXT,
    ledger_transaction_id UUID,
    date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_date ON transactions (date DESC);
CREATE INDEX idx_transactions_date_type ON transactions (date DESC, type);
CREATE INDEX idx_transactions_amount_date ON transactions (amount, date);
CREATE INDEX idx_transactions_category ON transactions (category_id);
CREATE INDEX idx_transactions_type ON transactions (type);
CREATE INDEX idx_transactions_account ON transactions (account_id);
CREATE INDEX idx_transactions_installment ON transactions (installment_plan_id);
CREATE INDEX idx_transactions_ledger ON transactions (ledger_transaction_id);
CREATE UNIQUE INDEX idx_transactions_idempotency ON transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE installment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    installment_number INT NOT NULL CHECK (installment_number >= 1),
    due_date DATE NOT NULL,
    transaction_id UUID REFERENCES transactions(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'paid')),
    -- Set when the installment is anticipated: it keeps its status, but its
    -- expense transaction is re-dated into the bill referenced here.
    anticipated_at TIMESTAMPTZ,
    anticipated_bill_id UUID REFERENCES card_bills(id) ON DELETE SET NULL,
    UNIQUE (plan_id, installment_number)
);

CREATE INDEX idx_installment_tx_due ON installment_transactions (due_date);
CREATE INDEX idx_installment_tx_status ON installment_transactions (status);
CREATE INDEX idx_installment_tx_anticipated ON installment_transactions (anticipated_at);

-- Anticipation batches, kept as an audit trail of "antecipar parcelas".
CREATE TABLE installment_anticipations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    bill_id UUID NOT NULL REFERENCES card_bills(id) ON DELETE CASCADE,
    anticipated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gross_amount NUMERIC(12, 2) NOT NULL CHECK (gross_amount >= 0),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    net_amount NUMERIC(12, 2) NOT NULL CHECK (net_amount >= 0)
);

CREATE INDEX idx_anticipations_card ON installment_anticipations (card_id);

CREATE TABLE installment_anticipation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anticipation_id UUID NOT NULL REFERENCES installment_anticipations(id) ON DELETE CASCADE,
    installment_transaction_id UUID NOT NULL REFERENCES installment_transactions(id),
    original_due_date DATE NOT NULL,
    original_amount NUMERIC(12, 2) NOT NULL,
    discounted_amount NUMERIC(12, 2) NOT NULL,
    UNIQUE (anticipation_id, installment_transaction_id)
);

-- ---------------------------------------------------------------------------
-- Budgets and alerts
-- ---------------------------------------------------------------------------

-- A row is a category budget (`category_id` set) or the overall monthly budget
-- (`category_id IS NULL`, one per month).
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    year SMALLINT NOT NULL,
    amount_limit NUMERIC(12, 2) NOT NULL CHECK (amount_limit > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_budget_category_month UNIQUE (category_id, month, year)
);

CREATE INDEX idx_budgets_period ON budgets (year, month);
-- NULLs never compare equal, so the overall budget needs its own partial index.
CREATE UNIQUE INDEX uq_budgets_overall_month ON budgets (year, month) WHERE category_id IS NULL;

-- Denormalized alert rows raised when a budget crosses a threshold, so the UI can
-- list and filter them without recomputing spend.
CREATE TABLE budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id),
    threshold NUMERIC(5, 2) NOT NULL CHECK (threshold > 0 AND threshold <= 100),
    actual_spent NUMERIC(12, 2),
    year SMALLINT,
    month SMALLINT,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_budget_alerts_budget ON budget_alerts (budget_id);
CREATE INDEX idx_budget_alerts_unacknowledged ON budget_alerts (acknowledged);
CREATE INDEX idx_budget_alerts_period ON budget_alerts (year, month, acknowledged);

-- ---------------------------------------------------------------------------
-- Double-entry ledger, event log and idempotency
-- ---------------------------------------------------------------------------

-- Immutable double-entry postings. `transaction_id` groups the two legs of a
-- transaction (normally equal to transactions.id).
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
CREATE INDEX idx_ledger_entries_date ON ledger_entries (recorded_at);
-- Also serves account-only lookups (leading column).
CREATE INDEX idx_ledger_entries_account_date ON ledger_entries (account_id, recorded_at DESC);

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

CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    response_status INT NOT NULL,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Receipts, stores and products
-- ---------------------------------------------------------------------------

CREATE TABLE normalized_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    cnpj TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One store per CNPJ, and one per name when the CNPJ is unknown, so the upsert in
-- the receipts API is idempotent.
CREATE UNIQUE INDEX uq_stores_cnpj ON stores (cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX uq_stores_name ON stores (lower(name)) WHERE cnpj IS NULL;

CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id),
    transaction_id UUID,
    -- 'nfce' for a parsed NFC-e QR code, 'ocr' for a scanned photo.
    source TEXT CONSTRAINT chk_receipts_source CHECK (source IS NULL OR source IN ('nfce', 'ocr')),
    total_amount NUMERIC(12, 2),
    receipt_date DATE,
    qr_data JSONB,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_store ON receipts (store_id);
CREATE INDEX idx_receipts_date ON receipts (receipt_date DESC);
CREATE INDEX idx_receipts_scanned_at ON receipts (scanned_at DESC);

CREATE TABLE receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    normalized_product_id UUID,
    description TEXT NOT NULL,
    quantity NUMERIC(10, 3) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2),
    total_price NUMERIC(12, 2),
    CONSTRAINT fk_receipt_items_product
        FOREIGN KEY (normalized_product_id) REFERENCES normalized_products(id) ON DELETE SET NULL
);

CREATE INDEX idx_receipt_items_receipt ON receipt_items (receipt_id);
CREATE INDEX idx_receipt_items_product ON receipt_items (normalized_product_id);

-- ---------------------------------------------------------------------------
-- Application settings
-- ---------------------------------------------------------------------------

-- Single row (`id` is always TRUE). `card_expense_dating` selects whether card
-- purchases are reported on their purchase date or on the bill's due date.
CREATE TABLE app_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    card_expense_dating TEXT NOT NULL DEFAULT 'purchase_date'
        CHECK (card_expense_dating IN ('purchase_date', 'due_date')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id) VALUES (TRUE);

-- ---------------------------------------------------------------------------
-- Reporting date helpers
-- ---------------------------------------------------------------------------

-- The `p_day` of the month containing `p_anchor`, clamped to the month's length
-- (day 31 becomes 28/29/30 where needed).
CREATE FUNCTION clamped_date_in_month(p_anchor DATE, p_day INT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT make_date(
        EXTRACT(YEAR FROM p_anchor)::int,
        EXTRACT(MONTH FROM p_anchor)::int,
        LEAST(
            p_day,
            EXTRACT(DAY FROM date_trunc('month', p_anchor) + INTERVAL '1 month - 1 day')::int
        )
    );
$$;

-- Due date ("vencimento") of the bill that contains `p_purchase` for card
-- `p_card`, or NULL when the account has no billing cycle. The bill closes on the
-- first `closing_day` on/after the purchase and is due on the first `due_day`
-- on/after that closing.
CREATE FUNCTION card_bill_due_date(p_card UUID, p_purchase DATE)
RETURNS DATE
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_closing SMALLINT;
    v_due SMALLINT;
    v_period_end DATE;
    v_due_date DATE;
BEGIN
    SELECT closing_day, due_day
      INTO v_closing, v_due
      FROM accounts
     WHERE id = p_card
       AND closing_day IS NOT NULL
       AND due_day IS NOT NULL;

    IF v_closing IS NULL OR v_due IS NULL THEN
        RETURN NULL;
    END IF;

    v_period_end := clamped_date_in_month(p_purchase, v_closing::int);
    IF v_period_end < p_purchase THEN
        v_period_end := clamped_date_in_month(
            (date_trunc('month', p_purchase) + INTERVAL '1 month')::date,
            v_closing::int
        );
    END IF;

    v_due_date := clamped_date_in_month(v_period_end, v_due::int);
    IF v_due_date < v_period_end THEN
        v_due_date := clamped_date_in_month(
            (date_trunc('month', v_period_end) + INTERVAL '1 month')::date,
            v_due::int
        );
    END IF;

    RETURN v_due_date;
END;
$$;

-- Reporting date of a transaction under a dating convention. 'due_date' only
-- moves credit-card purchases (accounts with a billing cycle); everything else,
-- including cards without `closing_day`/`due_day`, keeps its own date.
CREATE FUNCTION effective_transaction_date(p_date DATE, p_account UUID, p_dating TEXT)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_dating = 'due_date' AND p_account IS NOT NULL
            THEN COALESCE(card_bill_due_date(p_account, p_date), p_date)
        ELSE p_date
    END;
$$;
