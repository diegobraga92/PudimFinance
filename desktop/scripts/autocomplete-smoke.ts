/**
 * Description autocomplete smoke test.
 * Run with: npx tsx --tsconfig=tsconfig.app.json scripts/autocomplete-smoke.ts
 */
import 'fake-indexeddb/auto';

import { findPreviousTransaction } from '../src/offline/autocomplete';
import { replaceLocalTransactions, type LocalTransaction } from '../src/offline/database';
import { toAmountInput } from '../src/lib/money-input';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

function transaction(
  overrides: Partial<LocalTransaction> & Pick<LocalTransaction, 'id' | 'description'>,
): LocalTransaction {
  return {
    server_id: null,
    amount: '10.00',
    type: 'expense',
    category_id: null,
    date: '2026-01-01',
    notes: null,
    installment_plan_id: null,
    account_id: null,
    card_bill_period_end: null,
    synced: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function main(): Promise<void> {
  await replaceLocalTransactions([
    transaction({
      id: 'market',
      description: 'Groceries at Market',
      amount: '25.90',
      category_id: 'cat-food',
      account_id: 'acc-card',
      date: '2026-01-02',
    }),
    transaction({ id: 'coffee', description: 'Coffee', date: '2026-01-03' }),
  ]);

  const exact = await findPreviousTransaction('Groceries at Market');
  assert(exact?.amount === '25.90', 'the previous amount is returned');
  assert(exact?.category_id === 'cat-food', 'the previous category is returned');
  assert(exact?.account_id === 'acc-card', 'the previous account is returned');
  assert(
    toAmountInput(exact?.amount ?? '', 'pt-BR') === '25,90',
    'pt-BR shows the prefilled amount with a comma',
  );
  assert(
    toAmountInput(exact?.amount ?? '', 'en-US') === '25.90',
    'en-US shows the prefilled amount with a dot',
  );

  const withoutAccount = await findPreviousTransaction('Coffee');
  assert(withoutAccount?.account_id === null, 'a row without an account keeps the default');

  const fuzzy = await findPreviousTransaction('groc');
  assert(fuzzy?.account_id === 'acc-card', 'fuzzy matches use the newest transaction');

  assert(
    (await findPreviousTransaction('Nothing here')) === null,
    'an unknown description returns null',
  );

  console.log('\nAll autocomplete checks passed.');
}

void main();
