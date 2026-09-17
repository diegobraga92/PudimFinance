/** Pure smoke test for the seven-day spending-overview widget contract. */
import {
  buildWidgetSpendingData,
  collectWidgetTransactions,
  type WidgetSpendingData,
} from '../src/lib/widget';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

const today = '2026-09-16';
const transactions = [
  { amount: '10.50', date: '2026-09-10', type: 'expense' as const },
  { amount: '5.25', date: '2026-09-10', type: 'expense' as const },
  { amount: '20.00', date: '2026-09-12', type: 'expense' as const },
  { amount: '100.00', date: '2026-09-16', type: 'expense' as const },
  { amount: '1000.00', date: '2026-09-16', type: 'income' as const },
  { amount: '44.00', date: '2026-09-16', type: 'expense' as const },
  // Card-bill payments are ledger entries and must not be represented here;
  // an income row also demonstrates that the reducer excludes non-expenses.
];

const payload = buildWidgetSpendingData(
  transactions,
  today,
  'en',
  true,
  '2026-09-16T12:00:00.000Z',
);

assert(payload.days.length === 7, 'payload contains exactly seven days');
assert(payload.days[0].date === '2026-09-10', 'days are ordered oldest first');
assert(payload.days[6].date === today && payload.days[6].isToday, 'last day is today');
assert(payload.today.amount === 144 && payload.today.transactionCount === 2, 'today aggregates expenses only');
assert(payload.days[1].amount === 0 && payload.days[1].transactionCount === 0, 'empty days are represented as zero');
assert(payload.offline, 'offline state is preserved in the contract');
assert(payload.currency === 'BRL' && payload.locale === 'en', 'currency and locale are included');

const pages = [
  { items: transactions.slice(0, 2), total: transactions.length },
  { items: transactions.slice(2, 4), total: transactions.length },
  { items: transactions.slice(4), total: transactions.length },
];
const paged = await collectWidgetTransactions(async (page) => pages[page] ?? { items: [], total: transactions.length });
assert(paged.length === transactions.length, 'pagination merges every page');
assert(paged[4].amount === '1000.00', 'pagination preserves page ordering and values');

const empty: WidgetSpendingData = buildWidgetSpendingData([], today, 'pt-BR', false, '2026-09-16T12:00:00.000Z');
assert(empty.today.amount === 0 && empty.today.transactionCount === 0, 'empty state has zero today totals');
assert(empty.days.every((day) => day.amount === 0 && day.transactionCount === 0), 'empty state has zero chart values');
assert(empty.days.every((day, index) => day.isToday === (index === 6)), 'empty state still marks today');

const serialized = JSON.stringify(payload);
const decoded = JSON.parse(serialized) as WidgetSpendingData;
assert(decoded.today.amount === 144 && decoded.days.length === 7, 'serialized payload matches the pinned contract');
