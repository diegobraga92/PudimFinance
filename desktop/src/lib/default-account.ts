import type { AccountWithBalance } from '@/lib/api';

/** The account fields the default-account rules need. */
export type PaymentAccountLike = Pick<AccountWithBalance, 'id' | 'name' | 'type'> & {
  created_at?: string;
};

/**
 * Accounts a transaction may be paid from.
 *
 * Mirrors the server's `resolve_source_account`, which accepts asset and
 * liability accounts: filtering by `account_kind` (bank/cash/card) instead used
 * to hide the seeded credit card (`loan`) and any account created with another
 * kind, which made the picker look unchangeable.
 */
export function paymentAccountsOf<T extends PaymentAccountLike>(accounts: T[]): T[] {
  return accounts.filter((account) => account.type === 'asset' || account.type === 'liability');
}

/**
 * Picks the account a new transaction should start from, mirroring the server
 * order so the form shows the account the row will really be posted to instead
 * of an opaque label.
 *
 * Order: the account set as default on this device, the last one picked here,
 * then `Cash`, then `Bank Account`, then the oldest asset — the same fallbacks
 * `resolve_source_account` applies when no account is sent.
 */
export function resolveDefaultAccount<T extends PaymentAccountLike>(
  accounts: T[],
  options: { configuredId?: string | null; lastUsedId?: string | null } = {},
): T | null {
  const candidates = paymentAccountsOf(accounts);
  const byId = (id: string | null | undefined): T | null =>
    id ? candidates.find((account) => account.id === id) ?? null : null;

  const configured = byId(options.configuredId);
  if (configured) return configured;
  const lastUsed = byId(options.lastUsedId);
  if (lastUsed) return lastUsed;
  const named = candidates.find((account) => account.name === 'Cash');
  if (named) return named;
  const bank = candidates.find((account) => account.name === 'Bank Account');
  if (bank) return bank;

  return (
    candidates
      .filter((account) => account.type === 'asset')
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0] ?? null
  );
}

