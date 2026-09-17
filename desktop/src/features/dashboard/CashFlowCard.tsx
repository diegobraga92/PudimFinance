import * as React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toIntlLocale } from '@shared/i18n';
import { cn } from '@/lib/utils';

export interface CashFlowPoint {
  label: string;
  income: number;
  expenses: number;
  net: number;
  running: number;
}

/** Windows offered by the cash-flow chart. Each window uses a different time bucket. */
export type CashFlowRange = 1 | 3 | 6 | 12;

interface CashFlowCardProps {
  data: CashFlowPoint[];
  loading: boolean;
  range: CashFlowRange;
  onRangeChange: (range: CashFlowRange) => void;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'rgb(var(--surface-elevated))',
  border: '1px solid rgb(var(--border))',
  borderRadius: 10,
  fontSize: 12,
  color: 'rgb(var(--foreground))',
};

/** Income, expenses and cumulative net at the resolution selected by the time window. */
export function CashFlowCard({ data, loading, range, onRangeChange }: CashFlowCardProps) {
  const { t, locale, formatMoney } = useI18n();
  const intl = toIntlLocale(locale);
  const hasData = data.some((point) => point.income !== 0 || point.expenses !== 0 || point.net !== 0);
  // A single month has no line to draw, so the series opt into visible dots.
  // Explicit fills are required: Recharts' default marker fill is white.
  const dotFor = (color: string) =>
    data.length === 1 ? { r: 4, fill: color, stroke: 'none' } : false;

  return (
    <Card className="flex h-full flex-col border-border bg-surface shadow-card">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-5 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-lg font-semibold">{t('dashboard.cashFlow')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.cashFlowSubtitle')}</p>
        </div>
        <div className="flex shrink-0 gap-0.5 rounded-md bg-muted p-1">
          {([1, 3, 6, 12] as const).map((months) => (
            <button
              key={months}
              type="button"
              onClick={() => onRangeChange(months)}
              title={
                months === 1 ? t('dashboard.thisMonth') : t('dashboard.lastMonthsRange', { count: months })
              }
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                range === months
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {months}M
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-5 pt-0">
        {loading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : !hasData ? (
          <p className="flex h-[250px] items-center justify-center text-sm text-dim">
            {t('dashboard.noMonthlyData')}
          </p>
        ) : (
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="cashflow-income" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(var(--success))" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="rgb(var(--success))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cashflow-expense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(var(--danger))" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="rgb(var(--danger))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgb(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'rgb(var(--dim))' }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: 'rgb(var(--dim))' }}
                  tickLine={false}
                  axisLine={false}
                  width={68}
                  tickFormatter={(value: number) => axisValue(value, intl)}
                  label={{
                    value: 'R$',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fontSize: 11, fill: 'rgb(var(--dim))' },
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: 'rgb(var(--dim))' }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  domain={([dataMin, dataMax]) => [Math.min(dataMin, 0), Math.max(dataMax, 0)]}
                  tickFormatter={(value: number) => axisValue(value, intl)}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ stroke: 'rgb(var(--border))' }}
                  content={(props) => (
                    <CashFlowTooltip
                      {...props}
                      formatMoney={formatMoney}
                      labels={{
                        income: t('common.income'),
                        expenses: t('common.expenses'),
                        net: t('common.net'),
                        running: t('dashboard.runningNet'),
                      }}
                    />
                  )}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  iconType="circle"
                  iconSize={8}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  yAxisId="left"
                  name={t('common.income')}
                  stroke="rgb(var(--success))"
                  strokeWidth={2}
                  fill="url(#cashflow-income)"
                  dot={dotFor('rgb(var(--success))')}
                  activeDot={{ r: 3 }}
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  yAxisId="left"
                  name={t('common.expenses')}
                  stroke="rgb(var(--danger))"
                  strokeWidth={2}
                  fill="url(#cashflow-expense)"
                  dot={dotFor('rgb(var(--danger))')}
                  activeDot={{ r: 3 }}
                />
                <ReferenceLine
                  yAxisId="right"
                  y={0}
                  stroke="rgb(var(--dim))"
                  strokeDasharray="4 4"
                />
                <Line
                  type="monotone"
                  dataKey="running"
                  name={t('dashboard.runningNet')}
                  yAxisId="right"
                  stroke="rgb(var(--info))"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={dotFor('rgb(var(--info))')}
                  activeDot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CashFlowTooltip({
  active,
  label,
  payload,
  formatMoney,
  labels,
}: TooltipContentProps & {
  formatMoney: (value: number) => string;
  labels: Record<'income' | 'expenses' | 'net' | 'running', string>;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload as CashFlowPoint | undefined;
  if (!point) return null;

  const rows = [
    { label: 'income', value: point.income, color: 'rgb(var(--success))' },
    { label: 'expenses', value: point.expenses, color: 'rgb(var(--danger))' },
    { label: 'net', value: point.net, color: 'rgb(var(--dim))' },
    { label: 'running', value: point.running, color: 'rgb(var(--info))' },
  ];

  return (
    <div style={TOOLTIP_STYLE}>
      <p className="mb-2 font-medium text-foreground">{label}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
              {labels[row.label as keyof typeof labels]}
            </span>
            <span className="font-medium tabular-nums text-foreground">{formatMoney(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact axis labels (`1.2k`, `-350`) so the Y axis stays narrow. */
function axisValue(value: number, locale: string): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}k`;
  }
  return value.toLocaleString(locale, { maximumFractionDigits: 0 });
}
