/**
 * Default-account resolution smoke test.
 * Run with: npx tsx --tsconfig=tsconfig.app.json scripts/default-account-smoke.ts
 *
 * The form preselects this account, so it must mirror what the server does with
 * a null `account_id` (`resolve_source_account`: Cash, then Bank Account, then
 * the oldest asset) — otherwise the form shows one account and the row is
 * posted to another.
 */
import {
  paymentAccountsOf,
  resolveDefaultAccount,
  type PaymentAccountLike,
} from '../src/lib/default-account';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

type Fixture = PaymentAccountLike & { account_kind: string };

function account(
  id: string,
  name: string,
  type: string,
  accountKind: string,
  createdAt = '2026-01-01T00:00:00Z',
): Fixture {
  return { id, name, type, account_kind: accountKind, created_at: createdAt };
}

const cash = account('cash', 'Cash', 'asset', 'cash', '2026-01-01T00:00:00Z');
const bank = account('bank', 'Bank Account', 'asset', 'bank', '2026-01-02T00:00:00Z');
const card = account('card', 'Credit Card', 'liability', 'loan', '2026-01-03T00:00:00Z');
const wallet = account('wallet', 'NuConta', 'asset', 'other', '2026-01-04T00:00:00Z');
const ledger = account('expense', 'Food & Groceries', 'expense', 'expense');

const all = [cash, bank, card, wallet, ledger];

// The picker must offer every account the server accepts, including liabilities
// (the seeded credit card is `account_kind = "loan"`) and non-cash kinds.
const payable = paymentAccountsOf(all).map((a) => a.id);
assertEqual(payable.length, 4, 'payment accounts include asset and liability rows');
assert(payable.includes('card'), 'a liability (credit card) account is selectable');
assert(payable.includes('wallet'), 'an asset account with another kind is selectable');
assert(!payable.includes('expense'), 'ledger posting accounts stay out of the picker');

// The configured default wins while it still exists on this server.
assertEqual(
  resolveDefaultAccount(all, { configuredId: 'card' })?.id,
  'card',
  'the configured default is used',
);

// The last used account is the fallback when nothing is configured.
assertEqual(
  resolveDefaultAccount(all, { lastUsedId: 'wallet' })?.id,
  'wallet',
  'the last used account is used when no default is set',
);
assertEqual(
  resolveDefaultAccount(all, { configuredId: 'card', lastUsedId: 'wallet' })?.id,
  'card',
  'the configured default wins over the last used account',
);

// A stale id (the app was pointed at another server, or the row was deleted)
// must not be preselected: it falls through to the server's own order.
assertEqual(
  resolveDefaultAccount(all, { configuredId: 'gone', lastUsedId: 'also-gone' })?.id,
  'cash',
  'a stale configured or last-used id falls back to Cash',
);

// The server order without Cash: Bank Account, then the oldest asset.
assertEqual(
  resolveDefaultAccount([bank, wallet], {})?.id,
  'bank',
  'Bank Account is the fallback when Cash is gone',
);
assertEqual(
  resolveDefaultAccount([wallet, card], {})?.id,
  'wallet',
  'the oldest asset is the last fallback',
);
assertEqual(resolveDefaultAccount([], {})?.id, undefined, 'no accounts resolves to null');

console.log('\nDefault-account resolution OK.');
