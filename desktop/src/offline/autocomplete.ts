/**
 * Description-based auto-complete for the add-transaction form.
 *
 * Looks up the on-device mirror for a previous transaction whose description
 * matches what the user is typing, so the form can pre-fill the amount, type
 * and category from history.
 */

import { getLocalTransactions, type LocalTransaction } from './database';

export interface PreviousTransaction {
  amount: string;
  category_id: string | null;
  type: 'income' | 'expense';
}

/** Minimum input length before prefix/substring matching kicks in. */
const MIN_FUZZY_LENGTH = 3;

/** Normalizes a description for matching by lowercasing, stripping accents, and trimming. */
export function normalizeDescription(description: string): string {
  return description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds the most recent previous transaction that matches the given
 * description. Exact normalized matches always win, then a prefix match, then
 * a substring match (for inputs of at least 3 characters).
 */
export async function findPreviousTransaction(
  description: string,
): Promise<PreviousTransaction | null> {
  const needle = normalizeDescription(description);
  if (!needle) return null;

  let transactions: LocalTransaction[];
  try {
    transactions = await getLocalTransactions();
  } catch {
    return null;
  }

  const pick = (tx: LocalTransaction): PreviousTransaction => ({
    amount: tx.amount,
    category_id: tx.category_id,
    type: tx.type,
  });

  const exact = transactions.find((t) => normalizeDescription(t.description) === needle);
  if (exact) return pick(exact);

  if (needle.length < MIN_FUZZY_LENGTH) return null;

  const prefix = transactions.find((t) => normalizeDescription(t.description).startsWith(needle));
  if (prefix) return pick(prefix);

  const substring = transactions.find((t) => {
    const candidate = normalizeDescription(t.description);
    return candidate.includes(needle) && candidate.length > needle.length;
  });
  return substring ? pick(substring) : null;
}
