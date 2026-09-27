/**
 * Credit-card billing-cycle math.
 */

import type { AccountWithBalance } from '@/lib/api';

/** A bill option offered by the form. */
export interface BillOption {
  /** Closing date of the cycle — the value stored on the transaction. */
  periodEnd: string;
  /** Due date ("vencimento") of that cycle. */
  dueDate: string;
  /** `true` for the cycle the transaction date falls into. */
  isDerived: boolean;
}

/** Clamping day to the month, like the backend's `date_with_day`. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateWithDay(year: number, month: number, day: number): string {
  const clamped = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

function addMonths(year: number, month: number, months: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + months;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

/** Billing cycle of an account, or `null` when it is not a credit card. */
export function cardCycle(
  account: AccountWithBalance | undefined,
): { closingDay: number; dueDay: number } | null {
  if (!account || !account.closing_day || !account.due_day) return null;
  if (account.type !== 'liability') return null;
  return { closingDay: account.closing_day, dueDay: account.due_day };
}

/** Closing date of the cycle that contains `date`. */
export function cyclePeriodEnd(closingDay: number, date: string): string {
  const { year, month } = parts(date);
  const candidate = dateWithDay(year, month, closingDay);
  if (candidate >= date) return candidate;
  const next = addMonths(year, month, 1);
  return dateWithDay(next.year, next.month, closingDay);
}

/** Due date of the cycle that closes on `periodEnd`. */
export function cycleDueDate(dueDay: number, periodEnd: string): string {
  const { year, month } = parts(periodEnd);
  const candidate = dateWithDay(year, month, dueDay);
  if (candidate >= periodEnd) return candidate;
  const next = addMonths(year, month, 1);
  return dateWithDay(next.year, next.month, dueDay);
}

/** Moves a closing date by whole months, keeping the closing day. */
export function shiftPeriodEnd(closingDay: number, periodEnd: string, months: number): string {
  const { year, month } = parts(periodEnd);
  const shifted = addMonths(year, month, months);
  return dateWithDay(shifted.year, shifted.month, closingDay);
}

/** Whole months between two closing dates (positive when `to` is later). */
export function monthsBetweenCycles(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  return b.year * 12 + b.month - (a.year * 12 + a.month);
}

/**
 * Bill options for `date`: the derived cycle plus its neighbours, which is the
 * window the server accepts when a cycle is pinned explicitly.
 */
export function billOptions(account: AccountWithBalance | undefined, date: string): BillOption[] {
  const cycle = cardCycle(account);
  if (!cycle || !date) return [];
  const derived = cyclePeriodEnd(cycle.closingDay, date);
  return [-1, 0, 1].map((offset) => {
    const periodEnd = shiftPeriodEnd(cycle.closingDay, derived, offset);
    return {
      periodEnd,
      dueDate: cycleDueDate(cycle.dueDay, periodEnd),
      isDerived: offset === 0,
    };
  });
}

/** Due date of a stored cycle, or `null` when the account has no cycle. */
export function billDueDate(
  account: AccountWithBalance | undefined,
  periodEnd: string | null | undefined,
): string | null {
  const cycle = cardCycle(account);
  if (!cycle || !periodEnd) return null;
  return cycleDueDate(cycle.dueDay, periodEnd);
}
