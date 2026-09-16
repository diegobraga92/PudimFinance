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

interface MobileSummaryRowProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
  valueClassName?: string;
  secondaryLabel: string;
  secondaryValue: string;
  secondaryClassName?: string;
  loading: boolean;
}

function MobileSummaryRow({
  label,
  value,
  icon,
  tone,
  valueClassName,
  secondaryLabel,
  secondaryValue,
  secondaryClassName,
  loading,
}: MobileSummaryRowProps) {
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
          <span className="mt-1 block max-w-[12rem] truncate text-[11px] leading-tight text-dim">
            {secondaryLabel}{' '}
            <span className={cn('font-medium', secondaryClassName)}>{secondaryValue}</span>
          </span>
        )}
      </div>
    </div>
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

/** Compact phone summary with one row for each desktop headline card. */
function MobileAccountsSummary({
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
    <Card className="border-border bg-surface shadow-card md:hidden">
      <CardContent className="divide-y divide-border/60 p-0">
        <MobileSummaryRow
          label={t('accounts.summary.assets')}
          value={show(totalAssets)}
          icon={<Wallet className="h-4 w-4" />}
          tone="bg-info/15 text-info"
          valueClassName="text-success"
          secondaryLabel={t('accounts.summary.investments')}
          secondaryValue={show(investments)}
          secondaryClassName="text-success"
          loading={loading}
        />
        <MobileSummaryRow
          label={t('accounts.summary.liabilities')}
          value={available ? `- ${formatMoney(totalLiabilities)}` : '—'}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="bg-danger/15 text-danger"
          valueClassName="text-danger"
          secondaryLabel={t('accounts.summary.accountCount')}
          secondaryValue={t(countKey, { count: liabilityCount })}
          loading={loading}
        />
        <MobileSummaryRow
          label={t('accounts.summary.netWorth')}
          value={show(netWorth)}
          icon={<Scale className="h-4 w-4" />}
          tone="bg-success/15 text-success"
          valueClassName={netWorth >= 0 ? 'text-success' : 'text-danger'}
          secondaryLabel={t('accounts.summary.netThisMonth')}
          secondaryValue={monthlyNet === null ? '—' : formatMoney(monthlyNet)}
          secondaryClassName={monthlyNet !== null && monthlyNet < 0 ? 'text-danger' : 'text-success'}
          loading={loading}
        />
        <MobileSummaryRow
          label={t('accounts.summary.monthlyIncome')}
          value={monthlyIncome === null ? '—' : formatMoney(monthlyIncome)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="bg-purple/15 text-purple"
          valueClassName="text-foreground"
          secondaryLabel={t('common.expenses')}
          secondaryValue={monthlyExpenses === null ? '—' : formatMoney(monthlyExpenses)}
          secondaryClassName="text-danger"
          loading={loading}
        />
      </CardContent>
    </Card>
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
    <>
      <MobileAccountsSummary
        loading={loading}
        available={available}
        totalAssets={totalAssets}
        investments={investments}
        totalLiabilities={totalLiabilities}
        liabilityCount={liabilityCount}
        monthlyIncome={monthlyIncome}
        monthlyExpenses={monthlyExpenses}
        monthlyNet={monthlyNet}
      />
      <div className="hidden grid-cols-1 gap-4 md:grid md:grid-cols-2 xl:grid-cols-4">
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
    </>
  );
}
