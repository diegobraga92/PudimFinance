-- 011 User-facing account kinds.
--
-- Users think in "bank account", "cash", "credit card", "loan", and "investment",
-- not chart-of-accounts types. `account_kind` is the user-facing dimension, and
-- the accounting `type` is derived from it on write.

ALTER TABLE accounts ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'other';

-- Backfill existing accounts based on their current shape.
UPDATE accounts SET account_kind = 'cash'
  WHERE type = 'asset' AND name = 'Cash';

UPDATE accounts SET account_kind = 'card'
  WHERE type = 'liability' AND closing_day IS NOT NULL AND due_day IS NOT NULL;

UPDATE accounts SET account_kind = 'loan'
  WHERE type = 'liability' AND account_kind = 'other';

UPDATE accounts SET account_kind = 'bank'
  WHERE type = 'asset' AND account_kind = 'other' AND name <> 'Accounts Receivable';

UPDATE accounts SET account_kind = 'income' WHERE type = 'income';
UPDATE accounts SET account_kind = 'expense' WHERE type = 'expense';
UPDATE accounts SET account_kind = 'equity' WHERE type = 'equity';
