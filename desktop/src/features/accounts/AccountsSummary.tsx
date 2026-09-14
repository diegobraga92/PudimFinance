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
  totalLiabilities: number;
  /** Current-month income from the summary endpoint (null when unavailable). */
  monthlyIncome: number | null;
}

interface SummaryCardProps {
  label: string;
  value: string;
  caption?: string;
  icon: React.ReactNode;
  tone: string;
  valueClassName?: string;
  loading?: boolean;
}

function SummaryCard({
  label,
  value,
  caption,
  icon,
  tone,
  valueClassName,
  loading,
}: SummaryCardProps) {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', tone)}>
            {icon}
          </span>
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        </div>
        {loading ? (
          <>
            <Skeleton className="mt-4 h-7 w-32" />
            <Skeleton className="mt-3 h-3 w-20" />
          </>
        ) : (
          <>
            <p
              className={cn(
                'mt-4 truncate text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums',
                valueClassName,
              )}
            >
              {value}
            </p>
            {caption && <p className="mt-2.5 text-xs text-dim">{caption}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Headline position: what the user holds, what they owe, the difference, and
 * the month's income. All values come straight from account balances and the
 * monthly summary — no historical comparisons are invented.
 */
export function AccountsSummary({
  loading,
  available,
  totalAssets,
  totalLiabilities,
  monthlyIncome,
}: AccountsSummaryProps) {
  const { t, formatMoney } = useI18n();
  const netWorth = totalAssets - totalLiabilities;
  const show = (value: number) => (available ? formatMoney(value) : '—');

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label={t('accounts.summary.assets')}
        value={show(totalAssets)}
        icon={<Wallet className="h-5 w-5" />}
        tone="bg-info/15 text-info"
        valueClassName="text-success"
        loading={loading}
      />
      <SummaryCard
        label={t('accounts.summary.liabilities')}
        value={available ? `- ${formatMoney(totalLiabilities)}` : '—'}
        icon={<TrendingDown className="h-5 w-5" />}
        tone="bg-danger/15 text-danger"
        valueClassName="text-danger"
        loading={loading}
      />
      <SummaryCard
        label={t('accounts.summary.netWorth')}
        value={show(netWorth)}
        icon={<Scale className="h-5 w-5" />}
        tone="bg-success/15 text-success"
        valueClassName={netWorth >= 0 ? 'text-success' : 'text-danger'}
        loading={loading}
      />
      <SummaryCard
        label={t('accounts.summary.monthlyIncome')}
        value={monthlyIncome === null ? '—' : formatMoney(monthlyIncome)}
        caption={t('accounts.summary.thisMonth')}
        icon={<TrendingUp className="h-5 w-5" />}
        tone="bg-purple/15 text-purple"
        valueClassName="text-foreground"
        loading={loading}
      />
    </div>
  );
}
