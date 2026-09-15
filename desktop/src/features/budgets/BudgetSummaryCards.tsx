import { BellRing, CalendarClock, PiggyBank, TrendingDown } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { HEALTH_BAR, budgetHealth } from './budget-health';

/** Numbers the four headline cards are built from (computed by the page). */
export interface BudgetTotals {
  /** `true` when the user set an overall monthly limit. */
  hasOverall: boolean;
  /** Overall limit, or the sum of the category budgets when there is none. */
  limit: number;
  /** Overall spend, or the spend of budgeted categories when there is none. */
  spent: number;
  categoryBudgetCount: number;
  alertsTotal: number;
  alertsOver: number;
}

interface Props {
  loading: boolean;
  totals: BudgetTotals;
  monthLabel: string;
  onSetOverall: () => void;
}

/** Percentage of the limit already used (null when no limit is set). */
function percentUsed(totals: BudgetTotals): number | null {
  if (totals.limit <= 0) return null;
  return (totals.spent / totals.limit) * 100;
}

interface CardShellProps {
  icon: React.ReactNode;
  tone: string;
  label: string;
  children: React.ReactNode;
}

/** Icon + label header shared by the four cards (keeps the values aligned). */
function CardShell({ icon, tone, label, children }: CardShellProps) {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', tone)}>
            {icon}
          </span>
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Budget, spent, remaining and alerts for the selected month.
 *
 * The total falls back to the sum of the category budgets when no overall limit
 * is set, and says so — nothing is invented.
 */
export function BudgetSummaryCards({ loading, totals, monthLabel, onSetOverall }: Props) {
  const { t, formatMoney } = useI18n();

  const used = percentUsed(totals);
  const remaining = totals.limit - totals.spent;
  const health = budgetHealth(used ?? 0);
  const nothingSet = totals.limit <= 0 && !totals.hasOverall && totals.categoryBudgetCount === 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CardShell
        icon={<PiggyBank className="h-5 w-5" />}
        tone="bg-success/15 text-success"
        label={t('budgets.summary.total')}
      >
        {loading ? (
          <>
            <Skeleton className="mt-4 h-7 w-32" />
            <Skeleton className="mt-3 h-3 w-24" />
          </>
        ) : (
          <>
            <p className="mt-4 truncate text-2xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {nothingSet ? t('budgets.summary.notSet') : formatMoney(totals.limit)}
            </p>
            {nothingSet ? (
              <button
                type="button"
                onClick={onSetOverall}
                className="mt-2.5 text-xs font-medium text-primary hover:underline"
              >
                {t('budgets.summary.setOverall')}
              </button>
            ) : (
              <p className="mt-2.5 truncate text-xs text-dim">
                {totals.hasOverall
                  ? monthLabel
                  : t(
                      totals.categoryBudgetCount === 1
                        ? 'budgets.summary.fromCategories_one'
                        : 'budgets.summary.fromCategories_other',
                      { count: totals.categoryBudgetCount },
                    )}
              </p>
            )}
          </>
        )}
      </CardShell>

      <CardShell
        icon={<CalendarClock className="h-5 w-5" />}
        tone="bg-info/15 text-info"
        label={t('budgets.summary.spent')}
      >
        {loading ? (
          <>
            <Skeleton className="mt-4 h-7 w-32" />
            <Skeleton className="mt-3 h-3 w-24" />
          </>
        ) : (
          <>
            <p className="mt-4 truncate text-2xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {formatMoney(totals.spent)}
            </p>
            {used === null ? (
              <p className="mt-2.5 text-xs text-dim">{t('budgets.summary.noLimit')}</p>
            ) : (
              <>
                <p className="mt-2.5 text-xs text-dim">
                  {t('budgets.summary.percentOfBudget', { pct: Math.round(used) })}
                </p>
                <Progress
                  value={Math.min(used, 100)}
                  className="mt-2 h-1.5"
                  indicatorClassName={HEALTH_BAR[health]}
                />
              </>
            )}
          </>
        )}
      </CardShell>

      <CardShell
        icon={<TrendingDown className="h-5 w-5" />}
        tone="bg-info/15 text-info"
        label={t('budgets.remaining')}
      >
        {loading ? (
          <>
            <Skeleton className="mt-4 h-7 w-32" />
            <Skeleton className="mt-3 h-3 w-24" />
          </>
        ) : (
          <>
            <p
              className={cn(
                'mt-4 truncate text-2xl font-bold leading-none tracking-[-0.02em] tabular-nums',
                remaining < 0 ? 'text-danger' : 'text-success',
              )}
            >
              {formatMoney(remaining)}
            </p>
            <p className="mt-2.5 text-xs text-dim">
              {remaining < 0
                ? t('common.overBudget')
                : used === null
                  ? t('budgets.summary.noLimit')
                  : t('budgets.summary.percentLeft', { pct: Math.max(0, 100 - Math.round(used)) })}
            </p>
          </>
        )}
      </CardShell>

      <CardShell
        icon={<BellRing className="h-5 w-5" />}
        tone="bg-warning/15 text-warning"
        label={t('budgets.summary.alerts')}
      >
        {loading ? (
          <>
            <Skeleton className="mt-4 h-7 w-16" />
            <Skeleton className="mt-3 h-3 w-28" />
          </>
        ) : (
          <>
            <p className="mt-4 text-2xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {totals.alertsTotal}
            </p>
            <p className="mt-2.5 text-xs text-dim">
              {totals.alertsTotal === 0
                ? t('budgets.summary.noAlerts')
                : t('budgets.summary.overBudgetCount', { count: totals.alertsOver })}
            </p>
          </>
        )}
      </CardShell>
    </div>
  );
}
