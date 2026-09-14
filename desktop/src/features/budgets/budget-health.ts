import type { BudgetSummaryItem } from '@/lib/api';

/**
 * Budget health bands used for colours and copy.
 *
 * `ok` → healthy, `near` → approaching the limit (≥ 80%), `over` → exceeded
 * (≥ 100%). The bands match the thresholds the backend uses to raise alerts.
 */
export type BudgetHealth = 'ok' | 'near' | 'over';

export function budgetHealth(percentage: number): BudgetHealth {
  if (percentage >= 100) return 'over';
  if (percentage >= 80) return 'near';
  return 'ok';
}

/** Progress bar fill for a health band. */
export const HEALTH_BAR: Record<BudgetHealth, string> = {
  ok: 'bg-success',
  near: 'bg-warning',
  over: 'bg-danger',
};

/** Text tone for a health band. */
export const HEALTH_TEXT: Record<BudgetHealth, string> = {
  ok: 'text-success',
  near: 'text-warning',
  over: 'text-danger',
};

/** Percentage as a whole number (the API returns a decimal string). */
export function budgetPercent(item: BudgetSummaryItem): number {
  const value = Number.parseFloat(item.percentage);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/** Signed remaining amount: negative means over budget. */
export function budgetRemaining(item: BudgetSummaryItem): number {
  const value = Number.parseFloat(item.remaining);
  return Number.isFinite(value) ? value : 0;
}
