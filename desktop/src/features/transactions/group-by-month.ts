import type { Transaction } from '@/lib/api';

export interface TransactionMonthGroup {
  /** `YYYY-MM` of the group. */
  key: string;
  /** Display heading, e.g. `SEPTEMBER 2026`. */
  label: string;
  items: Transaction[];
}

/**
 * Groups transactions into month sections for the phone list.
 *
 * Input order is preserved, so the server's newest-first ordering produces
 * newest month first without extra sorting.
 */
export function groupTransactionsByMonth(
  transactions: Transaction[],
  monthNames: string[],
): TransactionMonthGroup[] {
  const groups: TransactionMonthGroup[] = [];
  for (const tx of transactions) {
    const key = tx.date.slice(0, 7);
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      const [yearPart, monthPart] = key.split('-');
      group = {
        key,
        label: `${monthNames[Number(monthPart) - 1] ?? monthPart} ${yearPart}`.toUpperCase(),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(tx);
  }
  return groups;
}
