import * as React from 'react';
import { Scale, TrendingDown, TrendingUp, Wallet } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AccountsSummaryProps {
  loading: boolean;
  /** `false` when a request failed — cards show a dash instead of zero. */
  available: boolean;
  totalAssets: number;
  /** Sum of the investment accounts (part of `totalAssets`). */
  investments: number;
  totalLiabilities: number;
  /** Accounts that make up the debt (cards + loans). */
  liabilityCount: number;
  /** Current-month figures from the summary endpoint (null when unavailable). */
  monthlyIncome: number | null;
  monthlyExpenses: number | null;
  /** Income − expenses for the current month. */
  monthlyNet: number | null;
}

interface SummaryCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
  valueClassName?: string;
  /** Right-hand column: a secondary figure, so nothing sits under the value. */
  aside?: React.ReactNode;
  loading?: boolean;
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
  valueClassName,
  aside,
  loading,
}: SummaryCardProps) {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="flex h-full items-start justify-between gap-3 p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', tone)}
            >
              {icon}
            </span>
            <span className="truncate text-[13px] font-medium text-muted-foreground">{label}</span>
          </div>
          {loading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <p
              className={cn(
                'truncate text-2xl font-bold leading-none tracking-[-0.02em] tabular-nums',
                valueClassName,
              )}
            >
              {value}
            </p>
          )}
        </div>
        {aside}
      </CardContent>
    </Card>
  );
}

/** Right-aligned secondary figure: a small label above its value. */
function AsideStat({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string;
  tone?: string;
  loading?: boolean;
}) {
  return (
    <div className="shrink-0 text-right">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="ml-auto mt-1.5 h-4 w-16" />
      ) : (
        <p className={cn('mt-1 text-base font-bold leading-tight tabular-nums', tone)}>{value}</p>
      )}
    </div>
  );
}

/**
 * Headline position: what the user holds, what they owe, the difference, and
 * the month's flow. Every card carries a secondary figure on the right (the
 * invested slice, how many debts, the month's net, the month's expenses), so the
 * value never floats alone with empty space beside it.
 */
export function AccountsSummary({
  loading,
  available,
  totalAssets,
  investments,
  totalLiabilities,
  liabilityCount,
  monthlyIncome,
  monthlyExpenses,
  monthlyNet,
}: AccountsSummaryProps) {
  const { t, formatMoney } = useI18n();
  const netWorth = totalAssets - totalLiabilities;
  const show = (value: number) => (available ? formatMoney(value) : '—');
  const countKey =
    liabilityCount === 1 ? 'accounts.group.count_one' : 'accounts.group.count_other';

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label={t('accounts.summary.assets')}
        value={show(totalAssets)}
        icon={<Wallet className="h-5 w-5" />}
        tone="bg-info/15 text-info"
        valueClassName="text-success"
        loading={loading}
        aside={
          <AsideStat
            label={t('accounts.summary.investments')}
            value={show(investments)}
            tone="text-success"
            loading={loading}
          />
        }
      />
      <SummaryCard
        label={t('accounts.summary.liabilities')}
        value={available ? `- ${formatMoney(totalLiabilities)}` : '—'}
        icon={<TrendingDown className="h-5 w-5" />}
        tone="bg-danger/15 text-danger"
        valueClassName="text-danger"
        loading={loading}
        aside={
          <AsideStat
            label={t('accounts.summary.accountCount')}
            value={t(countKey, { count: liabilityCount })}
            loading={loading}
          />
        }
      />
      <SummaryCard
        label={t('accounts.summary.netWorth')}
        value={show(netWorth)}
        icon={<Scale className="h-5 w-5" />}
        tone="bg-success/15 text-success"
        valueClassName={netWorth >= 0 ? 'text-success' : 'text-danger'}
        loading={loading}
        aside={
          <AsideStat
            label={t('accounts.summary.netThisMonth')}
            value={monthlyNet === null ? '—' : formatMoney(monthlyNet)}
            tone={monthlyNet !== null && monthlyNet < 0 ? 'text-danger' : 'text-success'}
            loading={loading}
          />
        }
      />
      <SummaryCard
        label={t('accounts.summary.monthlyIncome')}
        value={monthlyIncome === null ? '—' : formatMoney(monthlyIncome)}
        icon={<TrendingUp className="h-5 w-5" />}
        tone="bg-purple/15 text-purple"
        valueClassName="text-foreground"
        loading={loading}
        aside={
          <AsideStat
            label={t('common.expenses')}
            value={monthlyExpenses === null ? '—' : formatMoney(monthlyExpenses)}
            tone="text-danger"
            loading={loading}
          />
        }
      />
    </div>
  );
}
