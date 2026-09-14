import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp, Wallet } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toIntlLocale } from '@shared/i18n';
import { cn } from '@/lib/utils';

export interface SummaryDeltas {
  /** Month-over-month change in income, in percent (null when not comparable). */
  income: number | null;
  /** Month-over-month change in expenses, in percent. */
  expenses: number | null;
  /** Month-over-month change in the savings rate, in percentage points. */
  savings: number | null;
}

interface SummaryCardsProps {
  loading: boolean;
  /** `false` when the summary request failed — cards show a dash instead of zeros. */
  available: boolean;
  /** Sum of asset-account balances (the money the user actually has). */
  balance: number;
  /** Income − expenses for the selected month. */
  net: number;
  income: number;
  expenses: number;
  /** Share of income kept this month (null when there was no income). */
  savingsRate: number | null;
  deltas: SummaryDeltas;
}

/** `+12.4` / `-4.1`, locale aware and always signed. */
function signedNumber(value: number, locale: string): string {
  const formatted = value.toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return value >= 0 ? `+${formatted}` : formatted;
}

function percent(value: number, locale: string): string {
  return value.toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Month-over-month comparison. `invert` marks metrics where a decrease is good
 * (spending), so the color reflects the outcome rather than the direction.
 */
function DeltaLine({
  delta,
  suffix,
  invert,
}: {
  delta: number;
  suffix: string;
  invert?: boolean;
}) {
  const { t, locale } = useI18n();
  const up = delta >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-semibold tabular-nums',
          good ? 'text-success' : 'text-danger',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {signedNumber(delta, toIntlLocale(locale))}
        {suffix}
      </span>
      <span className="text-dim">{t('dashboard.vsLastMonth')}</span>
    </p>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconClassName: string;
  valueClassName?: string;
  delta?: number | null;
  /** Set when a lower value is the good outcome (expenses). */
  invertDelta?: boolean;
  deltaSuffix?: string;
  caption?: string;
  available?: boolean;
  loading?: boolean;
}

function SummaryCard({
  label,
  value,
  icon,
  iconClassName,
  valueClassName,
  delta,
  invertDelta,
  deltaSuffix = '%',
  caption,
  available = true,
  loading,
}: SummaryCardProps) {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
              iconClassName,
            )}
          >
            {icon}
          </span>
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        </div>

        {loading ? (
          <>
            <Skeleton className="mt-4 h-8 w-32" />
            <Skeleton className="mt-3 h-3 w-24" />
          </>
        ) : (
          <>
            <p
              className={cn(
                'mt-4 truncate text-[34px] font-bold leading-none tracking-[-0.025em] tabular-nums',
                valueClassName,
              )}
            >
              {available ? value : '—'}
            </p>
            {available && delta !== null && delta !== undefined ? (
              <DeltaLine delta={delta} suffix={deltaSuffix} invert={invertDelta} />
            ) : available && caption ? (
              <p className="mt-3 truncate text-xs text-dim">{caption}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}


/** Savings rate with a circular progress ring — the month's headline ratio. */
function SavingsRateCard({
  rate,
  delta,
  available = true,
  loading,
}: {
  rate: number | null;
  delta: number | null;
  available?: boolean;
  loading?: boolean;
}) {
  const { t, locale } = useI18n();
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const clamped = !available || rate === null ? 0 : Math.min(Math.max(rate, 0), 100);
  const offset = circumference - (clamped / 100) * circumference;
  const negative = rate !== null && rate < 0;

  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="flex h-full items-center gap-5 p-5">
        <div className="relative h-[92px] w-[92px] shrink-0">
          <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle
              cx="46"
              cy="46"
              r={radius}
              fill="none"
              strokeWidth="9"
              className="stroke-surface-hover"
            />
            <circle
              cx="46"
              cy="46"
              r={radius}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={cn('transition-all', negative ? 'stroke-danger' : 'stroke-success')}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {loading ? (
              <Skeleton className="h-6 w-14" />
            ) : (
              <span className="text-lg font-bold tabular-nums">
                {!available || rate === null ? '—' : `${percent(rate, toIntlLocale(locale))}%`}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">
            {t('dashboard.savingsRate')}
          </p>
          <p className="mt-1 text-xs text-dim">{t('dashboard.ofIncomeSaved')}</p>
          {!loading && available && delta !== null && <DeltaLine delta={delta} suffix=" pts" />}
        </div>
      </CardContent>
    </Card>
  );
}

/** The four headline numbers: balance, income, expenses and savings rate. */
export function SummaryCards({
  loading,
  available,
  balance,
  net,
  income,
  expenses,
  savingsRate,
  deltas,
}: SummaryCardsProps) {
  const { t, formatMoney } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label={t('dashboard.currentBalance')}
        value={formatMoney(balance)}
        caption={t('dashboard.netThisMonth', { amount: formatMoney(net) })}
        icon={<Wallet className="h-5 w-5" />}
        iconClassName="bg-primary/15 text-primary"
        valueClassName={balance >= 0 ? 'text-success' : 'text-danger'}
        available={available}
        loading={loading}
      />
      <SummaryCard
        label={t('common.income')}
        value={formatMoney(income)}
        icon={<TrendingUp className="h-5 w-5" />}
        iconClassName="bg-success/15 text-success"
        valueClassName="text-success"
        delta={deltas.income}
        available={available}
        loading={loading}
      />
      <SummaryCard
        label={t('common.expenses')}
        value={formatMoney(expenses)}
        icon={<TrendingDown className="h-5 w-5" />}
        iconClassName="bg-danger/15 text-danger"
        valueClassName="text-danger"
        delta={deltas.expenses}
        invertDelta
        available={available}
        loading={loading}
      />
      <SavingsRateCard
        rate={savingsRate}
        delta={deltas.savings}
        available={available}
        loading={loading}
      />
    </div>
  );
}
