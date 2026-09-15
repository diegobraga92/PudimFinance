-- Persist the account icon chosen by the user. The value is a stable shared
-- identifier; clients resolve it to an emoji or native icon at render time.
ALTER TABLE accounts ADD COLUMN icon TEXT;

UPDATE accounts
SET icon = CASE account_kind
    WHEN 'bank' THEN 'bank'
    WHEN 'cash' THEN 'money'
    WHEN 'card' THEN 'card'
    WHEN 'loan' THEN 'loan'
    WHEN 'investment' THEN 'trending-up'
    ELSE NULL
END
WHERE icon IS NULL;

CREATE UNIQUE INDEX uq_balance_adjustments_account
    ON accounts (name)
    WHERE type = 'equity' AND name = 'Balance adjustments';