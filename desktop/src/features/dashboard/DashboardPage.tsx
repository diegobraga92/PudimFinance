import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ArrowRight, ChevronLeft, ChevronRight, Wallet } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import {
  fetchAccountsWithBalance,
  fetchCategories,
  fetchSummary,
  fetchTransactions,
  type CategorySummary,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { categoryIcon } from '@shared/category-icons';
import { cn } from '@/lib/utils';

function StatCard({
  label,
  value,
  icon,
  accent,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: 'income' | 'expense' | 'default';
  loading?: boolean;
}) {
  const color =
    accent === 'income' ? 'text-income' : accent === 'expense' ? 'text-expense' : 'text-foreground';
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-28" />
          ) : (
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', color)}>{value}</p>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryBreakdown({ items, total }: { items: CategorySummary[]; total: number }) {
  const { t, formatMoney } = useI18n();
  const sorted = [...items].sort((a, b) => parseFloat(b.total) - parseFloat(a.total));

  if (sorted.length === 0) {
    return <p className="py-6 text-center text-sm text-dim">{t('common.none')}</p>;
  }

  return (
    <div className="space-y-3">
      {sorted.map((item) => {
        const amount = parseFloat(item.total);
        const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
        return (
          <div key={item.category_id ?? 'uncategorised'} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="text-base">{categoryIcon(item.icon)}</span>
                <span className="font-medium">{item.category_name ?? t('common.uncategorised')}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(item.total)}
                <span className="ml-2 text-xs text-dim">{pct}%</span>
              </span>
            </div>
            <Progress
              value={pct}
              className="h-1.5"
              indicatorClassName="bg-gradient-to-r from-primary/70 to-primary"
            />
          </div>
        );
      })}
    </div>
  );
}

/** Dashboard with month net, category breakdown, and recent activity. */
export function DashboardPage() {
  const { t, formatMoney, formatDate, monthNames } = useI18n();

  const now = new Date();
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth() + 1);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };
  const goCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  };

  const summaryQuery = useQuery({
    queryKey: ['summary', year, month],
    queryFn: () => fetchSummary({ month, year }),
  });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetchAccountsWithBalance(),
  });
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  const recentQuery = useQuery({
    queryKey: ['transactions', 'recent', year, month],
    queryFn: () =>
      fetchTransactions({
        page: 0,
        page_size: 8,
        start_date: monthStart,
        end_date: monthEnd,
      }),
  });

  const loading = summaryQuery.isLoading || categoriesQuery.isLoading;
  const summary = summaryQuery.data;
  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const recent = recentQuery.data?.items ?? [];

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const totalAssets = accounts
    .filter((a) => a.type === 'asset')
    .reduce((sum, a) => sum + parseFloat(a.balance), 0);

  const hasTransactions = recent.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.dashboard')}</h1>
          {/* Month navigation — the summary/breakdown cards follow this period */}
          <div className="mt-2 flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={prevMonth}
              aria-label={t('dashboard.prevMonth')}
              title={t('dashboard.prevMonth')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={goCurrentMonth}
              disabled={isCurrentMonth}
              className="min-w-36 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-80"
              title={t('dashboard.thisMonth')}
            >
              {monthNames[month - 1]} {year}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={nextMonth}
              disabled={isCurrentMonth}
              aria-label={t('dashboard.nextMonth')}
              title={t('dashboard.nextMonth')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('common.balance')}:</span>
          <span className="font-semibold tabular-nums">{formatMoney(totalAssets)}</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('dashboard.currentBalance')}
          value={summary ? formatMoney(summary.balance) : '—'}
          icon={<ArrowUpRight className="h-5 w-5" />}
          accent={summary && parseFloat(summary.balance) >= 0 ? 'income' : 'expense'}
          loading={loading}
        />
        <StatCard
          label={t('common.income')}
          value={summary ? formatMoney(summary.income_total) : '—'}
          icon={<ArrowUpRight className="h-5 w-5" />}
          accent="income"
          loading={loading}
        />
        <StatCard
          label={t('common.expenses')}
          value={summary ? formatMoney(summary.expense_total) : '—'}
          icon={<ArrowDownRight className="h-5 w-5" />}
          accent="expense"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Category breakdown */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('dashboard.categoryBreakdown')}</CardTitle>
            <CardDescription>
              {summary ? `${monthNames[summary.month - 1]} ${summary.year}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            ) : (
              <CategoryBreakdown
                items={summary?.by_category ?? []}
                total={parseFloat(summary?.expense_total ?? '0')}
              />
            )}
          </CardContent>
        </Card>

        {/* Recent transactions */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t('dashboard.recentTransactions')}</CardTitle>
            <Link
              to="/transactions"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {t('dashboard.viewAll')}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            {!hasTransactions && !recentQuery.isLoading ? (
              <div className="py-6 text-center">
                <p className="text-sm font-medium">{t('dashboard.noTransactionsTitle')}</p>
                <p className="mt-1 text-sm text-dim">{t('dashboard.noTransactionsDesc')}</p>
              </div>
            ) : recentQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((tx) => {
                  const cat = tx.category_id ? categoryById.get(tx.category_id) : undefined;
                  const isIncome = tx.type === 'income';
                  return (
                    <li key={tx.id} className="flex items-center gap-3 py-2.5">
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base',
                          isIncome ? 'bg-income/10' : 'bg-expense/10',
                        )}
                      >
                        {cat?.icon ? categoryIcon(cat.icon) : '•'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{tx.description}</p>
                        <p className="text-xs text-dim">
                          {formatDate(tx.date)}
                          {cat && <span className="ml-1.5">· {cat.name}</span>}
                          {tx.installment_plan_id && (
                            <Badge variant="secondary" className="ml-1.5">
                              {t('transactions.installment')}
                            </Badge>
                          )}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 text-sm font-semibold tabular-nums',
                          isIncome ? 'text-income' : 'text-expense',
                        )}
                      >
                        {isIncome ? '+' : '-'}
                        {formatMoney(tx.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
