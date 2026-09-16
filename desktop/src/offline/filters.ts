import type { LocalTransaction } from './database';

export interface LocalTransactionFilters {
  page?: number;
  page_size?: number;
  category_id?: string;
  type?: string;
  start_date?: string;
  end_date?: string;
  account_id?: string;
  sort?: 'date' | 'description' | 'amount' | 'category' | 'account';
  order?: 'asc' | 'desc';
}

/**
 * Applies the transaction-list filters to the local mirror.
 *
 * The server can account for credit-card effective dates; the local mirror
 * only has the transaction date, so date filtering intentionally uses `date`
 * while offline. This keeps the result useful and deterministic until the
 * next server sync.
 */
export function filterAndSortLocalTransactions(
  rows: LocalTransaction[],
  filters: LocalTransactionFilters = {},
): { items: LocalTransaction[]; total: number } {
  const filtered = rows.filter((row) => {
    if (filters.category_id && row.category_id !== filters.category_id) return false;
    if (filters.account_id && row.account_id !== filters.account_id) return false;
    if (filters.type && row.type !== filters.type) return false;
    if (filters.start_date && row.date < filters.start_date) return false;
    if (filters.end_date && row.date > filters.end_date) return false;
    return true;
  });

  const direction = filters.order === 'asc' ? 1 : -1;
  const sort = filters.sort ?? 'date';
  filtered.sort((a, b) => {
    let result = 0;
    switch (sort) {
      case 'description':
        result = a.description.localeCompare(b.description);
        break;
      case 'amount':
        result = (Number.parseFloat(a.amount) || 0) - (Number.parseFloat(b.amount) || 0);
        break;
      case 'category':
        result = (a.category_id ?? '').localeCompare(b.category_id ?? '');
        break;
      case 'account':
        result = (a.account_id ?? '').localeCompare(b.account_id ?? '');
        break;
      default:
        result = a.date.localeCompare(b.date);
        break;
    }
    return result === 0 ? a.id.localeCompare(b.id) * direction : result * direction;
  });

  const page = Math.max(0, filters.page ?? 0);
  const pageSize = Math.min(200, Math.max(1, filters.page_size ?? 50));
  return {
    items: filtered.slice(page * pageSize, (page + 1) * pageSize),
    total: filtered.length,
  };
}