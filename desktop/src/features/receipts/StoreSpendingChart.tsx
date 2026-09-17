import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { useI18n } from '@/app/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import type { StoreMonthlySpend } from '@/lib/api';

interface Props {
  months: StoreMonthlySpend[];
  loading: boolean;
  onSelectMonth?: (month: string) => void;
}

/** Spend per month at one store (backend buckets, nothing recalculated here). */
export function StoreSpendingChart({ months, loading, onSelectMonth }: Props) {
  const { t, formatMoney, shortMonthNames } = useI18n();

  const data = React.useMemo(
    () =>
      [...months]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((bucket) => {
          const month = Number.parseInt(bucket.month.slice(5, 7), 10);
          return {
            month: bucket.month,
            label: `${shortMonthNames[month - 1]}/${bucket.month.slice(2, 4)}`,
            total: Number.parseFloat(bucket.total ?? '0'),
            receipts: bucket.receipt_count,
          };
        }),
    [months, shortMonthNames],
  );

  if (loading) {
    return <Skeleton className="h-[200px] w-full rounded-md" />;
  }

  if (data.length === 0) {
    return (
      <p className="flex h-[200px] items-center justify-center text-sm text-dim">
        {t('receipts.storeNoSpending')}
      </p>
    );
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border) / 0.6)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'rgb(var(--muted-foreground))' }}
            stroke="rgb(var(--border))"
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'rgb(var(--muted-foreground))' }}
            stroke="rgb(var(--border))"
            tickLine={false}
            width={62}
            tickFormatter={(value: number) => formatMoney(value)}
          />
          <Tooltip
            cursor={{ fill: 'rgb(var(--primary) / 0.08)' }}
            contentStyle={{
              backgroundColor: 'rgb(var(--surface-elevated))',
              border: '1px solid rgb(var(--border))',
              borderRadius: 10,
              fontSize: 12,
              color: 'rgb(var(--foreground))',
            }}
            formatter={(value: unknown, _name: unknown, entry: unknown) => [
              formatMoney(Number(value ?? 0)),
              t('receipts.spentLabel', {
                count:
                  ((entry as { payload?: { receipts?: number } } | undefined)?.payload?.receipts ??
                    0),
              }),
            ]}
          />
          <Bar
            dataKey="total"
            fill="rgb(var(--primary))"
            radius={[4, 4, 0, 0]}
            maxBarSize={38}
            className={onSelectMonth ? 'cursor-pointer' : undefined}
            onClick={(entry) => {
              const month = (entry as { month?: string }).month;
              if (month) onSelectMonth?.(month);
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
