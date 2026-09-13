-- Credit card accounts with monthly billing cycles (faturas) and installment
-- anticipation ("antecipar parcelas").

-- Card-specific fields on accounts
-- (nullable, only meaningful for liability/card accounts)
ALTER TABLE accounts
    ADD COLUMN closing_day SMALLINT CHECK (closing_day IS NULL OR (closing_day BETWEEN 1 AND 31)),
    ADD COLUMN due_day SMALLINT CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31)),
    ADD COLUMN credit_limit NUMERIC(12,2) CHECK (credit_limit IS NULL OR credit_limit >= 0);

-- Link simple transactions to the source account (payment method).
ALTER TABLE transactions
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_account ON transactions (account_id);

-- Billing cycles ("faturas"), one row per card per closing date.
-- Total amount is computed on read from the card's transactions in the period.
-- Only the settlement state is persisted here.
CREATE TABLE card_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,           -- closing date (fatura fecha)
    due_date DATE NOT NULL,             -- payment deadline (vencimento)
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (card_id, period_end)
);

CREATE INDEX idx_card_bills_card ON card_bills (card_id);
CREATE INDEX idx_card_bills_due ON card_bills (due_date);

-- Installment plans can be tied to a card account so generated/payed
-- installment expenses carry the correct payment method.
ALTER TABLE installment_plans
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_installment_plans_account ON installment_plans (account_id);

-- Installment anticipation support.
-- Anticipated installments keep their status ('pending'/'generated') but are
-- marked here. Their linked expense transaction is re-dated and re-priced into
-- current billing period.
ALTER TABLE installment_transactions
    ADD COLUMN anticipated_at TIMESTAMPTZ,
    ADD COLUMN anticipated_bill_id UUID REFERENCES card_bills(id) ON DELETE SET NULL;

CREATE INDEX idx_installment_tx_anticipated ON installment_transactions (anticipated_at);

-- Anticipation batches (audit trail).
CREATE TABLE installment_anticipations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    bill_id UUID NOT NULL REFERENCES card_bills(id) ON DELETE CASCADE,
    anticipated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    net_amount NUMERIC(12,2) NOT NULL CHECK (net_amount >= 0)
);

CREATE INDEX idx_anticipations_card ON installment_anticipations (card_id);

CREATE TABLE installment_anticipation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anticipation_id UUID NOT NULL REFERENCES installment_anticipations(id) ON DELETE CASCADE,
    installment_transaction_id UUID NOT NULL REFERENCES installment_transactions(id),
    original_due_date DATE NOT NULL,
    original_amount NUMERIC(12,2) NOT NULL,
    discounted_amount NUMERIC(12,2) NOT NULL,
    UNIQUE (anticipation_id, installment_transaction_id)
);

CREATE INDEX idx_anticipation_items_anticipation ON installment_anticipation_items (anticipation_id);
