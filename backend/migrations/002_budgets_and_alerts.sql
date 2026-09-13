-- Layer 2 budgets and budget alerts

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    year SMALLINT NOT NULL,
    amount_limit NUMERIC(12, 2) NOT NULL CHECK (amount_limit > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_budget_category_month UNIQUE (category_id, month, year)
);

CREATE INDEX idx_budgets_period ON budgets (year, month);
CREATE INDEX idx_budgets_category ON budgets (category_id);

CREATE TABLE budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    threshold NUMERIC(5, 2) NOT NULL CHECK (threshold > 0 AND threshold <= 100),
    acknowledged BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_budget_alerts_budget ON budget_alerts (budget_id);
CREATE INDEX idx_budget_alerts_unacknowledged ON budget_alerts (acknowledged);