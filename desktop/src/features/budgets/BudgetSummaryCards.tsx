import { BellRing, CalendarClock, PiggyBank, TrendingDown } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { HEALTH_BAR, budgetHealth } from './budget-health';

/** Values displayed by the budget summary cards. */
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

function remainingAmount(totals: BudgetTotals): number {
  return totals.limit - totals.spent;
}

function nothingSet(totals: BudgetTotals): boolean {
  return totals.limit <= 0 && !totals.hasOverall && totals.categoryBudgetCount === 0;
}

interface CardShellProps {
  icon: React.ReactNode;
  tone: string;
  label: string;
  children: React.ReactNode;
}

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

interface MobileBudgetRowProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
  valueClassName?: string;
  secondary: React.ReactNode;
  loading: boolean;
}

function MobileBudgetRow({
  label,
  value,
  icon,
  tone,
  valueClassName,
  secondary,
  loading,
}: MobileBudgetRowProps) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', tone)}>
          {icon}
        </span>
        <span className="truncate text-[13px] font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="min-w-0 shrink-0 text-right">
        {loading ? (
          <Skeleton className="ml-auto h-5 w-24" />
        ) : (
          <span
            className={cn(
              'block max-w-[12rem] truncate text-base font-semibold leading-none tracking-[-0.01em] tabular-nums',
              valueClassName,
            )}
          >
            {value}
          </span>
        )}
        {loading ? (
          <Skeleton className="ml-auto mt-1.5 h-3 w-24" />
        ) : (
          <div className="mt-1 max-w-[12rem] truncate text-[11px] leading-tight text-dim">{secondary}</div>
        )}
      </div>
    </div>
  );
}

/** Compact phone summary with one row for each desktop headline card. */
function MobileBudgetSummary({ loading, totals, monthLabel, onSetOverall }: Props) {
  const { t, formatMoney } = useI18n();
  const used = percentUsed(totals);
  const remaining = remainingAmount(totals);
  const health = budgetHealth(used ?? 0);
  const unset = nothingSet(totals);

  return (
    <Card className="border-border bg-surface shadow-card md:hidden">
      <CardContent className="divide-y divide-border/60 p-0">
        <MobileBudgetRow
          label={t('budgets.summary.total')}
          value={unset ? t('budgets.summary.notSet') : formatMoney(totals.limit)}
          icon={<PiggyBank className="h-4 w-4" />}
          tone="bg-success/15 text-success"
          secondary={
            unset ? (
              <button
                type="button"
                onClick={onSetOverall}
                className="font-medium text-primary hover:underline"
              >
                {t('budgets.summary.setOverall')}
              </button>
            ) : totals.hasOverall ? (
              monthLabel
            ) : (
              t(
                totals.categoryBudgetCount === 1
                  ? 'budgets.summary.fromCategories_one'
                  : 'budgets.summary.fromCategories_other',
                { count: totals.categoryBudgetCount },
              )
            )
          }
          loading={loading}
        />
        <MobileBudgetRow
          label={t('budgets.summary.spent')}
          value={formatMoney(totals.spent)}
          icon={<CalendarClock className="h-4 w-4" />}
          tone="bg-info/15 text-info"
          secondary={
            used === null ? (
              t('budgets.summary.noLimit')
            ) : (
              <span className="inline-flex items-center justify-end gap-2">
                <span>{t('budgets.summary.percentOfBudget', { pct: Math.round(used) })}</span>
                <Progress
                  value={Math.min(used, 100)}
                  className="h-1 w-16"
                  indicatorClassName={HEALTH_BAR[health]}
                />
              </span>
            )
          }
          loading={loading}
        />
        <MobileBudgetRow
          label={t('budgets.remaining')}
          value={formatMoney(remaining)}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="bg-info/15 text-info"
          valueClassName={remaining < 0 ? 'text-danger' : 'text-success'}
          secondary={
            remaining < 0
              ? t('common.overBudget')
              : used === null
                ? t('budgets.summary.noLimit')
                : t('budgets.summary.percentLeft', { pct: Math.max(0, 100 - Math.round(used)) })
          }
          loading={loading}
        />
        <MobileBudgetRow
          label={t('budgets.summary.alerts')}
          value={String(totals.alertsTotal)}
          icon={<BellRing className="h-4 w-4" />}
          tone="bg-warning/15 text-warning"
          secondary={
            totals.alertsTotal === 0
              ? t('budgets.summary.noAlerts')
              : t('budgets.summary.overBudgetCount', { count: totals.alertsOver })
          }
          loading={loading}
        />
      </CardContent>
    </Card>
  );
}

/** Displays budget totals, spending, remaining amount, and alerts. */
export function BudgetSummaryCards({ loading, totals, monthLabel, onSetOverall }: Props) {
  const { t, formatMoney } = useI18n();

  const used = percentUsed(totals);
  const remaining = remainingAmount(totals);
  const health = budgetHealth(used ?? 0);
  const unset = nothingSet(totals);

  return (
    <>
      <MobileBudgetSummary
        loading={loading}
        totals={totals}
        monthLabel={monthLabel}
        onSetOverall={onSetOverall}
      />
      <div className="hidden grid-cols-1 gap-4 md:grid md:grid-cols-2 xl:grid-cols-4">
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
                {unset ? t('budgets.summary.notSet') : formatMoney(totals.limit)}
              </p>
              {unset ? (
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
    </>
  );
}
