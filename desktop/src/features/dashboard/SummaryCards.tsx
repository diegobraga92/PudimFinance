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
 * Month-over-month change chip. `invert` marks metrics where a decrease is good
 * (spending), so the color reflects the outcome rather than the direction.
 */
function DeltaBadge({
  delta,
  suffix = '%',
  invert,
}: {
  delta: number;
  suffix?: string;
  invert?: boolean;
}) {
  const { locale } = useI18n();
  const up = delta >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
        good ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {signedNumber(delta, toIntlLocale(locale))}
      {suffix}
    </span>
  );
}

/** Comparison chip plus its caption, for cards without a right-hand column. */
function DeltaNote({
  delta,
  suffix = '%',
  invert,
}: {
  delta: number;
  suffix?: string;
  invert?: boolean;
}) {
  const { t } = useI18n();
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <DeltaBadge delta={delta} suffix={suffix} invert={invert} />
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
  /**
   * Right-hand column: the month-over-month comparison, or a secondary figure
   * (the balance card shows the month's net there). Keeping it beside the
   * value removes the wide dead space the caption used to leave below.
   */
  aside?: React.ReactNode;
  available?: boolean;
  loading?: boolean;
}

function SummaryCard({
  label,
  value,
  icon,
  iconClassName,
  valueClassName,
  aside,
  available = true,
  loading,
}: SummaryCardProps) {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="flex h-full items-start justify-between gap-3 p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                iconClassName,
              )}
            >
              {icon}
            </span>
            <span className="truncate text-[13px] font-medium text-muted-foreground">
              {label}
            </span>
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
              {available ? value : '—'}
            </p>
          )}
        </div>

        {aside}
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
          <p className="mt-1 text-xs text-dim">{t('dashboard.savingsRateHint')}</p>
          {!loading && available && delta !== null && <DeltaNote delta={delta} suffix=" pts" />}
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

  /** Right-hand comparison column; omitted when there is no previous month. */
  const comparison = (delta: number | null, invert?: boolean) =>
    !loading && available && delta !== null ? (
      <div className="shrink-0 text-right">
        <DeltaBadge delta={delta} invert={invert} />
        <p className="mt-1 text-[10px] leading-tight text-dim">
          {t('dashboard.vsLastMonth')}
        </p>
      </div>
    ) : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label={t('dashboard.currentBalance')}
        value={formatMoney(balance)}
        icon={<Wallet className="h-5 w-5" />}
        iconClassName="bg-primary/15 text-primary"
        valueClassName={balance >= 0 ? 'text-success' : 'text-danger'}
        available={available}
        loading={loading}
        aside={
          loading ? (
            <div className="shrink-0 text-right">
              <Skeleton className="ml-auto h-2.5 w-16" />
              <Skeleton className="ml-auto mt-2 h-5 w-20" />
            </div>
          ) : (
            /* The month's net sits beside the balance (instead of a caption
             * below it) so the headline pair is readable at a glance. */
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('dashboard.netThisMonthLabel')}
              </p>
              <p
                className={cn(
                  'mt-1 text-lg font-bold leading-tight tabular-nums',
                  net >= 0 ? 'text-success' : 'text-danger',
                )}
              >
                {available ? formatMoney(net) : '—'}
              </p>
            </div>
          )
        }
      />
      <SummaryCard
        label={t('common.income')}
        value={formatMoney(income)}
        icon={<TrendingUp className="h-5 w-5" />}
        iconClassName="bg-success/15 text-success"
        valueClassName="text-success"
        aside={comparison(deltas.income)}
        available={available}
        loading={loading}
      />
      <SummaryCard
        label={t('common.expenses')}
        value={formatMoney(expenses)}
        icon={<TrendingDown className="h-5 w-5" />}
        iconClassName="bg-danger/15 text-danger"
        valueClassName="text-danger"
        aside={comparison(deltas.expenses, true)}
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
