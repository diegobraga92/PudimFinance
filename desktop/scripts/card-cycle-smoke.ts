/**
 * Credit-card bill math smoke test.
 * Run with: npx tsx --tsconfig=tsconfig.app.json scripts/card-cycle-smoke.ts
 */
import type { AccountWithBalance } from '../src/lib/api';
import {
  billDueDate,
  billOptions,
  cardCycle,
  cycleDueDate,
  cyclePeriodEnd,
  monthsBetweenCycles,
  shiftPeriodEnd,
} from '../src/lib/card-cycle';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

function account(
  type: string,
  closingDay: number | null,
  dueDay: number | null,
): AccountWithBalance {
  return {
    id: 'acc',
    name: 'Visa',
    type,
    account_kind: 'card',
    icon: null,
    parent_id: null,
    closing_day: closingDay,
    due_day: dueDay,
    credit_limit: '5000.00',
    balance: '0',
    transaction_count: 0,
    created_at: '2026-01-01T00:00:00Z',
  } as AccountWithBalance;
}

const card = account('liability', 5, 15);

// Same expectations as the backend `cycle_tests`.
assert(
  cyclePeriodEnd(5, '2026-01-20') === '2026-02-05',
  'a purchase after the closing moves to the next cycle',
);
assert(
  cyclePeriodEnd(5, '2026-01-03') === '2026-01-05',
  'a purchase before the closing stays in the current cycle',
);
assert(cyclePeriodEnd(31, '2026-02-15') === '2026-02-28', 'short months clamp the closing day');
assert(cycleDueDate(15, '2026-02-05') === '2026-02-15', 'the due date follows the closing date');
assert(
  cycleDueDate(10, '2026-02-20') === '2026-03-10',
  'a due day before the closing rolls into the next month',
);
assert(shiftPeriodEnd(31, '2026-01-31', 1) === '2026-02-28', 'shifting a cycle clamps the day');
assert(
  shiftPeriodEnd(5, '2026-01-05', -1) === '2025-12-05',
  'shifting back crosses the year boundary',
);
assert(monthsBetweenCycles('2026-01-05', '2026-03-05') === 2, 'cycles one month apart count as one');
assert(monthsBetweenCycles('2026-03-05', '2026-01-05') === -2, 'the delta is signed');

assert(cardCycle(card) !== null, 'a liability account with a cycle is a credit card');
assert(cardCycle(account('asset', 5, 15)) === null, 'a non-liability account is not a card');
assert(cardCycle(account('liability', null, null)) === null, 'a card without a cycle is unusable');

const options = billOptions(card, '2026-01-20');
assert(options.length === 3, 'the picker offers the previous, current and next cycle');
assert(
  options.map((option) => option.periodEnd).join(',') ===
    '2026-01-05,2026-02-05,2026-03-05',
  'bill options are consecutive cycles',
);
assert(options[1].isDerived, 'the middle option is the cycle derived from the date');
assert(
  options[2].dueDate === '2026-03-15',
  'the next cycle carries its own due date',
);
assert(billDueDate(card, '2026-02-05') === '2026-02-15', 'a pinned cycle resolves to its due date');
assert(billDueDate(card, null) === null, 'no pinned cycle means no due date');
assert(billOptions(account('liability', null, null), '2026-01-20').length === 0, 'no cycle, no options');

console.log('All card-cycle checks passed.');
