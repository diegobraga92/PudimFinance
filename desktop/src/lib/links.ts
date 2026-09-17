export interface TransactionLinkOptions {
  categoryId?: string;
  type?: 'income' | 'expense';
  startDate?: string;
  endDate?: string;
  accountId?: string;
}

function withParams(path: string, entries: Array<[string, string | undefined]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function transactionsLink(options: TransactionLinkOptions = {}): string {
  return withParams('/transactions', [
    ['category_id', options.categoryId],
    ['type', options.type],
    ['start_date', options.startDate],
    ['end_date', options.endDate],
    ['account_id', options.accountId],
  ]);
}

export function reportsLink(options: { tab?: 'overview' | 'breakdown' | 'trends'; categoryId?: string } = {}): string {
  return withParams('/reports', [
    ['tab', options.tab],
    ['category', options.categoryId],
  ]);
}

export function budgetsCategoriesLink(options: {
  year?: number;
  month?: number;
  categoryName?: string;
} = {}): string {
  return withParams('/budgets', [
    ['year', options.year === undefined ? undefined : String(options.year)],
    ['month', options.month === undefined ? undefined : String(options.month)],
    ['tab', 'categories'],
    ['category', options.categoryName],
  ]);
}

export function monthDateRange(year: number, month: number): { startDate: string; endDate: string } {
  const lastDay = new Date(year, month, 0).getDate();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return {
    startDate: `${prefix}-01`,
    endDate: `${prefix}-${String(lastDay).padStart(2, '0')}`,
  };
}