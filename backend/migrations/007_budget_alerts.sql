-- Budget alerts. Adds denormalized display/filter columns and a period index.
-- The budget_alerts table already exists (migration 002), so this only adds the
-- fields needed to list alerts joined with category info and filter by period.

ALTER TABLE budget_alerts ADD COLUMN actual_spent NUMERIC(12, 2);
ALTER TABLE budget_alerts ADD COLUMN category_id UUID REFERENCES categories(id);
ALTER TABLE budget_alerts ADD COLUMN year SMALLINT;
ALTER TABLE budget_alerts ADD COLUMN month SMALLINT;

CREATE INDEX idx_budget_alerts_period ON budget_alerts (year, month, acknowledged);
