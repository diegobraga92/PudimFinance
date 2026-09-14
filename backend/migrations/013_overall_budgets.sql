-- 013 Overall monthly budgets and category-hierarchy integrity.
--
-- A budget row with `category_id IS NULL` is the user's *overall* monthly
-- spending limit ("how much can I spend this month?"), independent of the
-- per-category limits. Category budgets keep their existing meaning; a budget
-- on a parent category covers spending in its descendants (see
-- `budgets::budget_summary`), so overlapping parent/child budgets are rejected
-- by the API rather than stacked here.
--
-- `categories.parent_id` already exists (migration 001); this migration adds
-- the indexes/constraints that the hierarchy UI and recursive queries rely on.

ALTER TABLE budgets ALTER COLUMN category_id DROP NOT NULL;

-- One overall budget per (year, month). A partial index is required because
-- NULLs never compare equal in a plain UNIQUE constraint.
CREATE UNIQUE INDEX uq_budgets_overall_month
    ON budgets (year, month)
    WHERE category_id IS NULL;

-- Recursive descendant lookups (budget spend, cycle checks) walk parent_id.
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id);

-- Backstop for a direct self-parent; deeper cycles are rejected by the API.
ALTER TABLE categories ADD CONSTRAINT chk_categories_parent_not_self
    CHECK (parent_id IS NULL OR parent_id <> id);
