-- 010 Unify the single-entry `transactions` table with the double-entry ledger.
--
-- Phase A of the reconciliation roadmap. The goals are these.
--
--   1. Every category is mapped to an income/expense ledger posting account
--      (`categories.ledger_account_id`) so posting is deterministic.
--   2. Every transaction is linked to a source account (`transactions.account_id`),
--      defaulting to the Cash asset account when none was chosen.
--   3. Existing transactions without ledger entries get a balanced pair
--      backfilled using their own id as the ledger group id
--      (`ledger_entries.transaction_id = transactions.id`), and
--      `transactions.ledger_transaction_id` is set to the same value.
--
-- After this migration, the API posts ledger entries at write time, so
-- Accounts/Ledger/Reconciliation and Summary/Budgets/Reports agree.

-- 1. Category -> posting account (the income/expense side of each transaction)
ALTER TABLE categories
    ADD COLUMN ledger_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

-- 2. Link categories to existing chart-of-accounts rows by name/type.
--    Mirrors the conventions previously hard-coded in the single-to-double
--    migration endpoint.
UPDATE categories c
SET ledger_account_id = a.id
FROM accounts a
WHERE c.ledger_account_id IS NULL
  AND a.type = c.type
  AND (
    a.name = c.name
    OR (c.type = 'income' AND c.name = 'Salary' AND a.name = 'Salary Income')
    OR (c.type = 'income' AND c.name = 'Freelance' AND a.name = 'Freelance Income')
    OR (c.type = 'income' AND c.name = 'Investments' AND a.name = 'Investment Income')
  );

-- 3. Create posting accounts for categories that have no matching account yet
--    (e.g. user-created categories), then link them.
INSERT INTO accounts (name, type)
SELECT c.name, c.type
FROM categories c
WHERE c.ledger_account_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounts a WHERE a.name = c.name AND a.type = c.type
  );

UPDATE categories c
SET ledger_account_id = a.id
FROM accounts a
WHERE c.ledger_account_id IS NULL
  AND a.name = c.name
  AND a.type = c.type;

-- 4. Backfill `account_id` for transactions that have none (defaults to Cash).
UPDATE transactions t
SET account_id = (
    SELECT a.id
    FROM accounts a
    WHERE a.type = 'asset'
    ORDER BY (a.name = 'Cash') DESC, (a.name = 'Bank Account') DESC, a.created_at
    LIMIT 1
)
WHERE t.account_id IS NULL;

-- 5. Backfill balanced ledger entries for every transaction without them.
--    For an expense, debit the expense account and credit the source account.
--    For income, debit the source account and credit the income account.
--    (LATERAL rows silently skip transactions whose account is unresolvable.)

-- Leg 1, the income/expense (posting) side.
INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
SELECT
    t.id,
    pa.id,
    CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END,
    CASE WHEN t.type = 'expense' THEN 0 ELSE t.amount END,
    t.description || ' (' || pa.name || ')'
FROM transactions t
JOIN LATERAL (
    SELECT a.id, a.name
    FROM accounts a
    WHERE a.id = COALESCE(
        (SELECT c.ledger_account_id FROM categories c WHERE c.id = t.category_id),
        (SELECT a2.id FROM accounts a2
          WHERE a2.type = t.type
            AND a2.name = COALESCE(
                (SELECT c2.name FROM categories c2 WHERE c2.id = t.category_id),
                CASE WHEN t.type = 'income' THEN 'Other Income' ELSE 'Miscellaneous' END
            )
          ORDER BY a2.created_at LIMIT 1),
        (SELECT a3.id FROM accounts a3 WHERE a3.type = t.type ORDER BY a3.created_at LIMIT 1)
    )
) pa ON TRUE
WHERE t.ledger_transaction_id IS NULL
  AND t.type IN ('income', 'expense')
  AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.transaction_id = t.id);

-- Leg 2, the source (payment) side.
INSERT INTO ledger_entries (transaction_id, account_id, debit_amount, credit_amount, description)
SELECT
    t.id,
    sa.id,
    CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END,
    CASE WHEN t.type = 'income' THEN 0 ELSE t.amount END,
    t.description || ' (' || sa.name || ')'
FROM transactions t
JOIN LATERAL (
    SELECT a.id, a.name
    FROM accounts a
    WHERE a.id = t.account_id
) sa ON TRUE
WHERE t.ledger_transaction_id IS NULL
  AND t.type IN ('income', 'expense')
  AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.transaction_id = t.id);

-- 6. Mark every transaction that now has ledger entries with its ledger group
--    id, unifying the convention that ledger_entries.transaction_id = transactions.id.
UPDATE transactions t
SET ledger_transaction_id = t.id
WHERE t.ledger_transaction_id IS NULL
  AND EXISTS (SELECT 1 FROM ledger_entries e WHERE e.transaction_id = t.id);
