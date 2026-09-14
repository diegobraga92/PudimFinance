-- 012 Credit-card expense dating preference.
--
-- A card purchase is always recorded and posted on the day it was made; the
-- double-entry ledger never moves. Reporting, however, can follow either
-- convention:
--
--   * 'purchase_date' (default) — a card expense counts in the month it was
--     made, which is what `transactions.date` already means.
--   * 'due_date' — a card expense counts in the month the bill ("fatura") that
--     contains it is due (vencimento), i.e. when the money actually leaves.
--
-- Transactions, categories and accounts are not user-scoped in this
-- deployment, so the preference is application-wide: a single-row settings
-- table rather than a column on `users`.

CREATE TABLE app_settings (
    -- Singleton guard: only one row may have id = TRUE.
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    card_expense_dating TEXT NOT NULL DEFAULT 'purchase_date'
        CHECK (card_expense_dating IN ('purchase_date', 'due_date')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- Card billing-cycle date math.
--
-- Mirrors `cycle_for_date` in `backend/src/routes/credit_cards.rs`: card bills
-- are materialized lazily in `card_bills`, so the cycle of a purchase has to be
-- derivable from the card's own `closing_day`/`due_day` (which is also why
-- changing those days immediately changes past reporting, with nothing to
-- backfill).

-- Returns the `p_day` of the month containing `p_anchor`, clamped to the
-- month's length (so day 31 becomes 28/29/30 where needed).
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

-- Returns the due date ("vencimento") of the bill that contains `p_purchase`
-- for the card `p_card`, or NULL when the account has no billing cycle.
--
--   * the bill closes on the first `closing_day` on/after the purchase;
--   * it is due on the first `due_day` on/after that closing (same month when
--     `due_day >= closing_day`, otherwise the following month).
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

-- Reporting date of a transaction under a dating convention.
--
-- `p_dating = 'due_date'` only moves credit-card purchases (accounts with a
-- billing cycle); every other transaction — and cards without `closing_day` /
-- `due_day` — keeps its own date.
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
