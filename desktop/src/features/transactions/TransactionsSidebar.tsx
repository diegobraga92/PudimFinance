import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchSummary } from '@/lib/api';
import { categoryIcon } from '@shared/category-icons';
import { cn } from '@/lib/utils';

/** Category rows listed in the "top spending" card. */
const MAX_CATEGORIES = 5;
/** Months offered by the summary's selector (newest first). */
const MONTH_CHOICES = 12;

/**
 * Right-hand column of the transactions screen: the selected month's totals
 * (income, expenses and a headline net) and the categories eating most of it.
 * Both cards read the same `summary` payload, so switching month refetches once.
 */
export function TransactionsSidebar() {
  const { t, formatMoney, monthNames } = useI18n();
  const [period, setPeriod] = React.useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  const months = React.useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTH_CHOICES }, (_, offset) => {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return {
        value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: `${monthNames[date.getMonth()]} ${date.getFullYear()}`,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
      };
    });
  }, [monthNames]);

  const summaryQuery = useQuery({
    queryKey: ['summary', period.year, period.month],
    queryFn: () => fetchSummary({ month: period.month, year: period.year }),
  });

  const summary = summaryQuery.data;
  const loading = summaryQuery.isLoading;
  const income = Number.parseFloat(summary?.income_total ?? '0');
  const expenses = Number.parseFloat(summary?.expense_total ?? '0');
  const net = income - expenses;

  const categories = React.useMemo(() => {
    const rows = (summary?.by_category ?? [])
      .map((item) => ({
        key: item.category_id ?? 'uncategorised',
        name: item.category_name ?? t('common.uncategorised'),
        icon: item.icon,
        color: item.color,
        amount: Number.parseFloat(item.total) || 0,
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // Percentages are shares of the month's expenses, so they add up to 100%.
    const total = rows.reduce((sum, row) => sum + row.amount, 0) || expenses;
    return rows
      .slice(0, MAX_CATEGORIES)
      .map((row) => ({ ...row, pct: total > 0 ? Math.round((row.amount / total) * 100) : 0 }));
  }, [summary, expenses, t]);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Month totals — the selected month defaults to the current one. */}
      <Card className="border-border bg-surface shadow-card">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 p-5 pb-3">
          <CardTitle className="text-base font-semibold">
            {t('transactions.summary.title')}
          </CardTitle>
          <select
            aria-label={t('transactions.summary.month')}
            className="h-8 shrink-0 rounded-md border border-input bg-surface px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]"
            value={`${period.year}-${String(period.month).padStart(2, '0')}`}
            onChange={(event) => {
              const choice = months.find((entry) => entry.value === event.target.value);
              if (choice) setPeriod({ year: choice.year, month: choice.month });
            }}
          >
            {months.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </CardHeader>

        <CardContent className="p-5 pt-0">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('common.income')}</dt>
              <dd className="font-semibold tabular-nums text-income">
                {loading ? <Skeleton className="h-4 w-20" /> : formatMoney(income)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('common.expenses')}</dt>
              <dd className="font-semibold tabular-nums text-expense">
                {loading ? <Skeleton className="h-4 w-20" /> : formatMoney(expenses)}
              </dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-border/60 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('common.net')}
            </p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-32" />
            ) : (
              <p
                className={cn(
                  'mt-1 text-3xl font-bold leading-none tracking-[-0.02em] tabular-nums',
                  net >= 0 ? 'text-success' : 'text-danger',
                )}
              >
                {formatMoney(net)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Where the month's money went, biggest first. */}
      <Card className="border-border bg-surface shadow-card">
        <CardHeader className="p-5 pb-3">
          <CardTitle className="text-base font-semibold">
            {t('transactions.topCategories')}
          </CardTitle>
        </CardHeader>

        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-1.5 w-full" />
                </div>
              ))}
            </div>
          ) : categories.length === 0 ? (
            <p className="text-sm text-dim">{t('reports.noExpensesMonth')}</p>
          ) : (
            <ul className="space-y-3.5">
              {categories.map((row) => (
                <li key={row.key} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-base">{row.icon ? categoryIcon(row.icon) : '•'}</span>
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney(row.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={Math.min(row.pct, 100)}
                      className="h-1.5 flex-1"
                      indicatorStyle={row.color ? { backgroundColor: row.color } : undefined}
                    />
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-dim">
                      {row.pct}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
