/**
 * Installment-edit smoke test (run with
 * `npx tsx --tsconfig=tsconfig.app.json scripts/installments-smoke.ts`).
 *
 * Requires a PudimFinance backend on http://localhost:3000 by default (override
 * with PUDIM_SMOKE_SERVER, handy when testing a locally built binary on another
 * port) with a reachable Postgres.
 *
 * Regression cover for "editing a single-payment transaction to N installments
 * did nothing": `PUT /api/transactions/{id}` used to ignore `installments`
 * (serde drops unknown fields), so no plan was ever created.
 */
import 'fake-indexeddb/auto';

// Minimal localStorage shim (auth, server config, and the mirror read it).
const lsStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsStore.set(k, v);
  },
  removeItem: (k: string) => {
    lsStore.delete(k);
  },
  clear: () => lsStore.clear(),
  key: (i: number) => Array.from(lsStore.keys())[i] ?? null,
  get length() {
    return lsStore.size;
  },
};

import {
  createTransaction,
  fetchAccountsWithBalance,
  fetchInstallmentPlan,
  fetchTransactions,
  registerUser,
  updateTransaction,
} from '../src/lib/api';
import { setAuthSession } from '../src/lib/auth';
import { ApiError } from '../src/lib/request';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

function money(value: unknown): number {
  return Number(value);
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function transactionById(id: string) {
  const list = await fetchTransactions({ page: 0, page_size: 200 });
  return list.items.find((t) => t.id === id);
}

async function main(): Promise<void> {
  // Point the client at the backend under test before the first request.
  lsStore.set('pudim_server_url', process.env.PUDIM_SMOKE_SERVER ?? 'http://localhost:3000');

  const email = `installments${Date.now()}@test.dev`;
  const reg = await registerUser({ email, password: 'password123' });
  await setAuthSession(reg.access_token, reg.refresh_token, reg.user);
  console.log('PASS: register + session');

  const accounts = await fetchAccountsWithBalance();
  const account = accounts.find((a) => a.type === 'liability') ?? accounts[0];
  assert(Boolean(account), 'an account exists to post to');

  const tag = String(Date.now());
  const total = 300;
  const base = {
    description: `Installment edit ${tag}`,
    amount: total.toFixed(2),
    type: 'expense' as const,
    date: isoDate(0),
    account_id: account.id,
  };

  // 1. The reported bug: a plain transaction is edited into 3 installments.
  const plain = await createTransaction(base);
  assert(plain.installment_plan_id === null, 'a single-payment create has no plan');

  const edited = await updateTransaction(plain.id, { ...base, installments: 3 });
  assert(Boolean(edited.installment_plan_id), 'editing to 3 installments created a plan');
  assert(
    money(edited.amount) === total / 3,
    `the edited row holds the installment amount (got ${edited.amount})`,
  );

  const plans = await fetchInstallmentPlan(edited.installment_plan_id!);
  assert(plans.installments.length === 3, 'the plan has 3 installments');
  assert(money(plans.plan.total_amount) === total, 'the plan keeps the purchase total');
  assert(
    money(plans.plan.installment_amount) === total / 3,
    'the plan stores the installment amount',
  );

  const ordered = [...plans.installments].sort(
    (a, b) => a.installment_number - b.installment_number,
  );
  assert(ordered[0].transaction_id === plain.id, 'the edited row became installment 1');
  assert(
    ordered.every((i, idx) => idx === 0 || ordered[idx - 1].due_date < i.due_date),
    'installments are dated on the following months',
  );

  const rows = await Promise.all(ordered.map((i) => transactionById(i.transaction_id!)));
  assert(rows.every(Boolean), 'every installment is materialized as a transaction');
  const rowAmounts = rows.map((r) => money(r!.amount));
  assert(
    Math.abs(rowAmounts.reduce((a, b) => a + b, 0) - total) < 0.005,
    `installment amounts add up to the total (${rowAmounts.join(' + ')})`,
  );
  assert(
    rows.every((r) => r!.installment_plan_id === edited.installment_plan_id),
    'every installment row links to the plan',
  );
  assert(
    rows.every((r) => r!.account_id === account.id),
    'every installment row keeps the chosen account',
  );

  // 2. A plan-linked row cannot be re-split: the plan owns its schedule.
  let rejected: number | null = null;
  try {
    await updateTransaction(plain.id, { ...base, installments: 2 });
  } catch (err) {
    rejected = err instanceof ApiError ? err.status : -1;
  }
  assert(rejected === 400, `re-splitting a plan-linked row is rejected with 400 (got ${rejected})`);

  // 3. Capture-style create with an account and installments (what the review
  //    dialog's approve() now sends).
  const capture = await createTransaction({
    description: `Captured installments ${tag}`,
    amount: '120.00',
    type: 'expense',
    date: isoDate(0),
    account_id: account.id,
    installments: 2,
  });
  assert(Boolean(capture.installment_plan_id), 'a capture with installments creates a plan');
  assert(money(capture.amount) === 60, 'the capture row holds the first installment amount');

  const capturePlan = await fetchInstallmentPlan(capture.installment_plan_id!);
  assert(capturePlan.installments.length === 2, 'the capture plan has 2 installments');
  assert(
    money(capturePlan.plan.total_amount) === 120,
    'the capture plan total is the purchase total',
  );

  const captureRows = await Promise.all(
    capturePlan.installments.map((i) => transactionById(i.transaction_id!)),
  );
  assert(
    captureRows.every((r) => Boolean(r) && r!.account_id === account.id),
    'the capture installments post to the selected account',
  );
}

main()
  .then(() => {
    console.log('\nAll installment smoke checks passed.');
  })
  .catch((err) => {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
