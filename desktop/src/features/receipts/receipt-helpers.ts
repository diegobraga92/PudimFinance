import type { StorePeriod } from '@/lib/api';
import type { TranslationKey } from '@shared/i18n';

/** Price direction relative to the previous recorded value. */
export interface PriceChange {
  direction: 'up' | 'down' | 'flat';
  percentage: number;
}

/** Normalises the API's change percentage into a displayable direction. */
export function priceChange(value: string | number | null | undefined): PriceChange | null {
  if (value === null || value === undefined) return null;
  const percentage = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(percentage)) return null;
  if (percentage > 0) return { direction: 'up', percentage };
  if (percentage < 0) return { direction: 'down', percentage };
  return { direction: 'flat', percentage: 0 };
}

/** Store-screen period filters. */
export const STORE_PERIODS: StorePeriod[] = ['month', 'last_month', '3m', '6m', 'year', 'all'];

/** Translation key for each store period. */
export const PERIOD_LABEL_KEY: Record<StorePeriod, TranslationKey> = {
  month: 'receipts.periodMonth',
  last_month: 'receipts.periodLastMonth',
  '3m': 'receipts.period3m',
  '6m': 'receipts.period6m',
  year: 'receipts.periodYear',
  all: 'receipts.periodAll',
};