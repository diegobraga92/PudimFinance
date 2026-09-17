import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useI18n } from '@/app/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductPriceRecord } from '@/lib/api';
import { chartPointAtIndex, useChartTooltipTrigger } from '@/lib/chart-events';

interface Props {
  records: ProductPriceRecord[];
  loading: boolean;
  onSelectRecord?: (record: ProductPriceRecord) => void;
}

/**
 * Actual recorded prices, oldest to newest.
 *
 * Nothing is interpolated or smoothed: every dot is a price that was paid on a
 * receipt, which is why the tooltip carries the store too.
 */
export function PriceHistoryChart({ records, loading, onSelectRecord }: Props) {
  const { t, formatMoney, formatDate, shortMonthNames } = useI18n();
  const tooltipTrigger = useChartTooltipTrigger();

  const data = React.useMemo(
    () =>
      [...records]
        .filter((record) => record.price !== null && record.price !== undefined)
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
        .map((record) => {
          const iso = record.date ?? '';
          const month = Number.parseInt(iso.slice(5, 7), 10);
          const day = iso.slice(8, 10);
          return {
            record,
            date: iso,
            // "Sep 14" — the chart spans months, so the day matters too.
            label:
              Number.isFinite(month) && day
                ? `${shortMonthNames[month - 1]} ${day}`
                : formatDate(iso),
            price: Number.parseFloat(record.price ?? '0'),
            store: record.store_name ?? t('receipts.unknownStore'),
          };
        }),
    [records, formatDate, shortMonthNames, t],
  );

  if (loading) {
    return <Skeleton className="h-[220px] w-full rounded-md" />;
  }

  return (
    <div className="h-[220px] w-full" data-testid="price-history-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
          onClick={(state) => {
            const point = chartPointAtIndex(state, data);
            if (point) onSelectRecord?.(point.record);
          }}
        >
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
            trigger={tooltipTrigger}
            contentStyle={{
              backgroundColor: 'rgb(var(--surface-elevated))',
              border: '1px solid rgb(var(--border))',
              borderRadius: 10,
              fontSize: 12,
              color: 'rgb(var(--foreground))',
            }}
            formatter={(value: unknown) => [formatMoney(Number(value ?? 0)), t('receipts.pricePaid')]}
            labelFormatter={(_label, payload) => {
              const point = payload?.[0]?.payload as { date?: string; store?: string } | undefined;
              return point
                ? `${point.date ? formatDate(point.date) : ''} · ${point.store ?? ''}`
                : '';
            }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="rgb(var(--primary))"
            strokeWidth={2}
            dot={{ r: 3, fill: 'rgb(var(--primary))' }}
            activeDot={{ r: 5, cursor: onSelectRecord ? 'pointer' : undefined }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
