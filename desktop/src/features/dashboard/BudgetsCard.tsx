import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CategoryIcon } from '@/components/CategoryIcon';
import { cn } from '@/lib/utils';
import type { BudgetSummaryItem } from '@/lib/api';
import { rowInteractiveClass, rowKeyboardProps, tapClass } from '@/lib/interactive';
import { monthDateRange, transactionsLink } from '@/lib/links';

interface BudgetsCardProps {
  items: BudgetSummaryItem[];
  loading: boolean;
  month: number;
  year: number;
  /** `/budgets?month=&year=` so "View all" keeps the dashboard's period. */
  viewAllLink: string;
}

/** Budgets shown on the dashboard before the list is truncated. */
const MAX_BUDGETS = 4;

/** Green → amber → red as a budget approaches and crosses its limit. */
function barColor(pct: number): string {
  if (pct >= 100) return 'bg-danger';
  if (pct >= 80) return 'bg-warning';
  return 'bg-success';
}

/** The most relevant category budgets for the selected month (closest to their limit). */
export function BudgetsCard({ items, loading, month, year, viewAllLink }: BudgetsCardProps) {
  const { t, formatMoney, monthNames } = useI18n();
  const navigate = useNavigate();
  // The dashboard lists category budgets; the overall monthly limit is a
  // headline figure that belongs on the budgets screen.
  const rows = [...items]
    .filter((item) => item.budget.category_id !== null && item.budget.category_id !== undefined)
    .sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage))
    .slice(0, MAX_BUDGETS);
  const { startDate, endDate } = monthDateRange(year, month);
  const rowHref = (item: BudgetSummaryItem) => transactionsLink({
    categoryId: item.budget.category_id ?? undefined,
    type: 'expense',
    startDate,
    endDate,
    includeSubcategories: true,
  });

  return (
    <Card className="flex h-full min-w-0 flex-col border-border bg-surface shadow-card">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-5 pb-3">
        <CardTitle className="text-lg font-semibold">{t('nav.budgets')}</CardTitle>
        <Link
          to={viewAllLink}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t('dashboard.viewAll')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>

      <CardContent className="flex-1 p-5 pt-0">
        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm font-medium">
              {t('dashboard.noBudgets', { month: monthNames[month - 1], year })}
            </p>
            <p className="mt-1 text-xs text-dim">{t('dashboard.noBudgetsDesc')}</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border/60 md:hidden">
              {rows.map((item) => {
                const pct = Math.round(parseFloat(item.percentage));
                const over = pct >= 100;
                return (
                  <li key={item.budget.id} className="py-3 first:pt-0 last:pb-0">
                    <Link
                      to={rowHref(item)}
                      className={cn('block rounded-sm', rowInteractiveClass, tapClass)}
                    >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <CategoryIcon name={item.budget.icon} className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate text-sm font-medium">
                          {item.budget.category_name ?? t('common.uncategorised')}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-right text-xs font-medium tabular-nums',
                          over ? 'text-danger' : 'text-muted-foreground',
                        )}
                      >
                        <span>{formatMoney(item.actual_spent)}</span>
                        <span className="font-normal text-dim"> / {formatMoney(item.budget.amount_limit)}</span>
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Progress
                        value={Math.min(pct, 100)}
                        className="h-1.5 flex-1"
                        indicatorClassName={barColor(pct)}
                      />
                      <span
                        className={cn(
                          'w-10 shrink-0 text-right text-xs font-semibold tabular-nums',
                          over ? 'text-danger' : 'text-muted-foreground',
                        )}
                      >
                        {pct}%
                      </span>
                    </div>
                    {over && (
                      <span className="mt-1 block text-[11px] font-medium text-danger">
                        {t('common.overBudget')}
                      </span>
                    )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="hidden md:block">
              <Table className="[&_td:first-child]:pl-0 [&_th:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[34%]">{t('common.category')}</TableHead>
                    <TableHead className="w-[18%]">{t('dashboard.budgetUsed')}</TableHead>
                    <TableHead className="text-right">
                      {t('dashboard.budgetSpentOfLimit')}
                    </TableHead>
                    <TableHead className="w-10 text-right">{t('dashboard.budgetPercent')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => {
                    const pct = Math.round(parseFloat(item.percentage));
                    const over = pct >= 100;
                    return (
                      <TableRow
                        key={item.budget.id}
                        onClick={() => navigate(rowHref(item))}
                        {...rowKeyboardProps(() => navigate(rowHref(item)))}
                        className={cn(rowInteractiveClass, tapClass)}
                      >
                        <TableCell className="py-3">
                          <span className="flex items-center gap-2">
                            <CategoryIcon name={item.budget.icon} className="h-4 w-4" />
                            <span className="min-w-0 truncate text-sm font-medium">
                              {item.budget.category_name ?? t('common.uncategorised')}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="py-3">
                          <Progress
                            value={Math.min(pct, 100)}
                            className="h-1.5"
                            indicatorClassName={barColor(pct)}
                          />
                        </TableCell>
                        <TableCell
                          className={cn(
                            'py-3 text-right text-sm font-medium tabular-nums',
                            over ? 'text-danger' : 'text-muted-foreground',
                          )}
                        >
                          <span>{formatMoney(item.actual_spent)}</span>
                          <span className="font-normal text-dim"> / {formatMoney(item.budget.amount_limit)}</span>
                          {over && (
                            <span className="block text-[11px] font-medium text-danger">
                              {t('common.overBudget')}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'py-3 text-right text-xs font-semibold tabular-nums',
                            over ? 'text-danger' : 'text-muted-foreground',
                          )}
                        >
                          {pct}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
