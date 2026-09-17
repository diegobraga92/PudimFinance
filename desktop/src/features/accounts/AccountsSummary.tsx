import * as React from 'react';
import { CreditCard, Scale, TrendingDown, type LucideIcon } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AccountsSummaryProps {
  loading: boolean;
  /** `false` when a request failed — cards show a dash instead of zero. */
  available: boolean;
  totalAssets: number;
  totalLiabilities: number;
  /** Accounts that make up the debt (cards + loans). */
  liabilityCount: number;
  /** Outstanding balance across credit-card accounts. */
  creditUsed: number;
  /** Remaining credit across cards with a configured limit. */
  creditAvailable: number;
  /** Whether at least one card has a configured credit limit. */
  hasCreditLimits: boolean;
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

interface SummaryItem {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
  valueClassName: string;
  secondaryLabel: string;
  secondaryValue: string;
  secondaryClassName?: string;
}

/** Compact phone summary with one row for each desktop headline card. */
function MobileAccountsSummary({ items, loading }: { items: SummaryItem[]; loading: boolean }) {
  return (
    <Card className="border-border bg-surface shadow-card md:hidden">
      <CardContent className="divide-y divide-border/60 p-0">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <MobileSummaryRow
              key={item.key}
              label={item.label}
              value={item.value}
              icon={<Icon className="h-4 w-4" />}
              tone={item.tone}
              valueClassName={item.valueClassName}
              secondaryLabel={item.secondaryLabel}
              secondaryValue={item.secondaryValue}
              secondaryClassName={item.secondaryClassName}
              loading={loading}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * Headline position: net worth, what is owed, and credit capacity. The assets
 * total remains visible as the net-worth card's secondary figure, while credit
 * usage gives card holders an actionable view that is not duplicated on the
 * dashboard. The same item list drives desktop cards and mobile rows.
 */
export function AccountsSummary({
  loading,
  available,
  totalAssets,
  totalLiabilities,
  liabilityCount,
  creditUsed,
  creditAvailable,
  hasCreditLimits,
}: AccountsSummaryProps) {
  const { t, formatMoney } = useI18n();
  const netWorth = totalAssets - totalLiabilities;
  const show = (value: number) => (available ? formatMoney(value) : '—');
  const countKey =
    liabilityCount === 1 ? 'accounts.group.count_one' : 'accounts.group.count_other';
  const creditAvailableTone = creditAvailable >= 0 ? 'text-success' : 'text-danger';

  const items: SummaryItem[] = [
    {
      key: 'net-worth',
      label: t('accounts.summary.netWorth'),
      value: show(netWorth),
      icon: Scale,
      tone: 'bg-success/15 text-success',
      valueClassName: netWorth >= 0 ? 'text-success' : 'text-danger',
      secondaryLabel: t('accounts.summary.assets'),
      secondaryValue: show(totalAssets),
      secondaryClassName: 'text-success',
    },
    {
      key: 'liabilities',
      label: t('accounts.summary.liabilities'),
      value: available ? `- ${formatMoney(totalLiabilities)}` : '—',
      icon: TrendingDown,
      tone: 'bg-danger/15 text-danger',
      valueClassName: 'text-danger',
      secondaryLabel: t('accounts.summary.accountCount'),
      secondaryValue: t(countKey, { count: liabilityCount }),
    },
  ];

  if (hasCreditLimits) {
    items.push({
      key: 'credit-used',
      label: t('accounts.summary.creditUsed'),
      value: show(creditUsed),
      icon: CreditCard,
      tone: 'bg-purple/15 text-purple',
      valueClassName: 'text-danger',
      secondaryLabel: t('accounts.summary.creditAvailable'),
      secondaryValue: show(creditAvailable),
      secondaryClassName: creditAvailableTone,
    });
  }

  return (
    <>
      <MobileAccountsSummary items={items} loading={loading} />
      <div
        className={cn(
          'hidden grid-cols-1 gap-4 md:grid md:grid-cols-2',
          hasCreditLimits ? 'xl:grid-cols-3' : 'xl:grid-cols-2',
        )}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <SummaryCard
              key={item.key}
              label={item.label}
              value={item.value}
              icon={<Icon className="h-5 w-5" />}
              tone={item.tone}
              valueClassName={item.valueClassName}
              loading={loading}
              aside={
                <AsideStat
                  label={item.secondaryLabel}
                  value={item.secondaryValue}
                  tone={item.secondaryClassName}
                  loading={loading}
                />
              }
            />
          );
        })}
      </div>
    </>
  );
}