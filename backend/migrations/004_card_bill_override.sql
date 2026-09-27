-- Explicit card-bill assignment.

ALTER TABLE transactions
    ADD COLUMN card_bill_period_end DATE;

COMMENT ON COLUMN transactions.card_bill_period_end IS
    'Closing date of the credit-card bill this purchase belongs to. NULL derives the cycle from "date".';

CREATE INDEX idx_transactions_card_bill
    ON transactions (account_id, card_bill_period_end)
    WHERE card_bill_period_end IS NOT NULL;

ALTER TABLE installment_plans
    ADD COLUMN card_bill_period_end DATE;

COMMENT ON COLUMN installment_plans.card_bill_period_end IS
    'Closing date of the bill the first installment lands on. NULL derives it from "start_date".';

CREATE FUNCTION card_bill_total(p_card UUID, p_period_start DATE, p_period_end DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT SUM(t.amount)
      FROM transactions t
     WHERE t.account_id = p_card
       AND t.type = 'expense'
       AND CASE
             WHEN t.card_bill_period_end IS NOT NULL
                 THEN t.card_bill_period_end = p_period_end
             ELSE t.date >= p_period_start AND t.date <= p_period_end
           END;
$$;

CREATE FUNCTION bill_due_date_for_period(p_card UUID, p_period_end DATE)
RETURNS DATE
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_due SMALLINT;
    v_due_date DATE;
BEGIN
    SELECT due_day
      INTO v_due
      FROM accounts
     WHERE id = p_card
       AND due_day IS NOT NULL;

    IF v_due IS NULL THEN
        RETURN NULL;
    END IF;

    v_due_date := clamped_date_in_month(p_period_end, v_due::int);
    IF v_due_date < p_period_end THEN
        v_due_date := clamped_date_in_month(
            (date_trunc('month', p_period_end) + INTERVAL '1 month')::date,
            v_due::int
        );
    END IF;

    RETURN v_due_date;
END;
$$;

DROP FUNCTION effective_transaction_date(DATE, UUID, TEXT);

CREATE FUNCTION effective_transaction_date(
    p_date DATE,
    p_account UUID,
    p_dating TEXT,
    p_period_end DATE
)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_dating <> 'due_date' THEN p_date
        WHEN p_period_end IS NOT NULL AND p_account IS NOT NULL
            THEN COALESCE(bill_due_date_for_period(p_account, p_period_end), p_date)
        WHEN p_account IS NOT NULL
            THEN COALESCE(card_bill_due_date(p_account, p_date), p_date)
        ELSE p_date
    END;
$$;
