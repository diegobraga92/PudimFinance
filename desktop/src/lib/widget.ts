/** Android spending-overview widget synchronization. */
import { toIntlLocale, type Locale } from '@shared/i18n';

import { fetchTransactions, type Transaction } from '@/lib/api';
import { toIsoDate } from '@/lib/date-input';
import { isOnline } from '@/offline/net';
import { setWidgetSpending, setWidgetTheme } from '@/notifications/native';

export interface WidgetSpendingDay {
  date: string;
  label: string;
  amount: number;
  isToday: boolean;
  transactionCount: number;
}

export interface WidgetSpendingData {
  today: { amount: number; transactionCount: number };
  days: WidgetSpendingDay[];
  currency: 'BRL';
  locale: Locale;
  dateLabel: string;
  offline: boolean;
  lastUpdated: string;
}

const PAGE_SIZE = 200;
const MAX_PAGES = 10;

function shiftDate(iso: string, offset: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

function labelForDate(iso: string, locale: Locale): string {
  const intl = toIntlLocale(locale);
  const label = new Intl.DateTimeFormat(intl, { weekday: 'short' })
    .format(new Date(`${iso}T12:00:00`))
    .replace(/\.$/, '');
  return label ? `${label.charAt(0).toLocaleUpperCase(intl)}${label.slice(1)}` : label;
}

function dateLabelForDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
    .format(new Date(`${iso}T12:00:00`))
    .replace(/\.$/, '');
}

/** Pure aggregation used by the widget smoke test and the production refresh path. */
export function buildWidgetSpendingData(
  transactions: Pick<Transaction, 'amount' | 'date' | 'type'>[],
  todayIso: string,
  locale: Locale,
  offline = false,
  lastUpdated = new Date().toISOString(),
): WidgetSpendingData {
  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(todayIso, index - 6));
  const totals = new Map(dates.map((date) => [date, { amount: 0, transactionCount: 0 }]));

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    const entry = totals.get(transaction.date.slice(0, 10));
    if (!entry) continue;
    const amount = Number.parseFloat(transaction.amount);
    if (!Number.isFinite(amount)) continue;
    entry.amount += Math.max(0, amount);
    entry.transactionCount += 1;
  }

  const days = dates.map((date) => ({
    date,
    label: labelForDate(date, locale),
    amount: totals.get(date)?.amount ?? 0,
    transactionCount: totals.get(date)?.transactionCount ?? 0,
    isToday: date === todayIso,
  }));
  const today = days[days.length - 1];
  return {
    today: { amount: today.amount, transactionCount: today.transactionCount },
    days,
    currency: 'BRL',
    locale,
    dateLabel: dateLabelForDate(todayIso, locale),
    offline,
    lastUpdated,
  };
}

export async function collectWidgetTransactions<Item>(
  fetchPage: (page: number) => Promise<{ items: Item[]; total: number }>,
): Promise<Item[]> {
  const collected: Item[] = [];
  let page = 0;
  let total = Number.POSITIVE_INFINITY;
  while (collected.length < total && page < MAX_PAGES) {
    const response = await fetchPage(page);
    collected.push(...response.items);
    total = response.total;
    if (response.items.length === 0) break;
    page += 1;
  }
  return collected;
}

async function fetchWidgetTransactions(startDate: string, endDate: string): Promise<Transaction[]> {
  return collectWidgetTransactions((page) =>
    fetchTransactions({
      type: 'expense',
      start_date: startDate,
      end_date: endDate,
      page,
      page_size: PAGE_SIZE,
    }),
  );
}

async function computeWidgetSpending(locale: Locale, today = new Date()): Promise<WidgetSpendingData> {
  const todayIso = toIsoDate(today);
  const [offline, transactions] = await Promise.all([
    isOnline().then((online) => !online),
    fetchWidgetTransactions(shiftDate(todayIso, -6), todayIso),
  ]);
  return buildWidgetSpendingData(transactions, todayIso, locale, offline);
}

let refreshInFlight: Promise<void> | null = null;

/** Recomputes the aggregate and coalesces concurrent widget refresh requests. */
export function refreshWidgetSpending(locale: Locale): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = computeWidgetSpending(locale)
    .then((data) => setWidgetSpending(JSON.stringify(data)))
    .catch(() => {
      // Widget refreshes are best effort and must not affect the app shell.
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function pushWidgetTheme(theme: 'light' | 'dark'): Promise<void> {
  return setWidgetTheme(theme);
}