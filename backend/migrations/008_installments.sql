-- Installment plans (Parcelas) that split a purchase into N monthly payments.

CREATE TABLE installment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
    installments INT NOT NULL CHECK (installments >= 2 AND installments <= 60),
    installment_amount NUMERIC(12,2) NOT NULL CHECK (installment_amount >= 0),
    category_id UUID REFERENCES categories(id),
    start_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_installment_plans_start ON installment_plans (start_date);
CREATE INDEX idx_installment_plans_category ON installment_plans (category_id);

CREATE TABLE installment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    installment_number INT NOT NULL CHECK (installment_number >= 1),
    due_date DATE NOT NULL,
    transaction_id UUID REFERENCES transactions(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'generated', 'paid')),
    UNIQUE (plan_id, installment_number)
);

CREATE INDEX idx_installment_tx_plan ON installment_transactions (plan_id);
CREATE INDEX idx_installment_tx_due ON installment_transactions (due_date);
CREATE INDEX idx_installment_tx_status ON installment_transactions (status);

-- Link simple transactions to their installment plan (NULL = not an installment).
ALTER TABLE transactions ADD COLUMN installment_plan_id UUID REFERENCES installment_plans(id);
CREATE INDEX idx_transactions_installment ON transactions (installment_plan_id);
