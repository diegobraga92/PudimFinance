import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { resolveCategoryColors } from '@/lib/category-colors';
import { fitTextSize } from '@/lib/fit-text';
import { CategoryIcon } from '@/components/CategoryIcon';

/** Aggregated remainder glyph tone (muted slate). */
const OTHERS_COLOR = '#64748b';
/** Rows shown before the tail is folded into "Miscellaneous". */
const MAX_ROWS = 6;

export interface DonutItem {
  key: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  amount: number;
}

interface CategoryDonutProps {
  items: DonutItem[];
  total: number;
  loading: boolean;
  title: string;
  /** Caption under the total in the middle of the ring. */
  centerLabel: string;
  action?: React.ReactNode;
  emptyTitle: string;
  emptyHint?: string;
  /** Optional class for the loading/empty placeholders' height. */
  className?: string;
}

/** Donut + legend of where money went, shared by the dashboard and budgets. */
export function CategoryDonut({
  items,
  total,
  loading,
  title,
  centerLabel,
  action,
  emptyTitle,
  emptyHint,
  className,
}: CategoryDonutProps) {
  const { t, formatMoney } = useI18n();

  const rows = React.useMemo(() => {
    const sorted = items
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const colors = resolveCategoryColors(sorted);
    const head = sorted.slice(0, MAX_ROWS).map((item) => ({
      ...item,
      color: colors.get(item.key),
      pct: total > 0 ? Math.round((item.amount / total) * 100) : 0,
    }));

    const tail = sorted.slice(MAX_ROWS);
    if (tail.length > 0) {
      const amount = tail.reduce((sum, item) => sum + item.amount, 0);
      head.push({
        key: 'others',
        name: t('common.miscellaneous'),
        icon: null,
        color: OTHERS_COLOR,
        amount,
        pct: total > 0 ? Math.round((amount / total) * 100) : 0,
      });
    }
    return head;
  }, [items, total, t]);

  return (
    <Card className={className ?? 'flex h-full flex-col border-border bg-surface shadow-card'}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-5 pb-3">
        <p className="min-w-0 truncate text-lg font-semibold">{title}</p>
        {action}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-center p-5 pt-0">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="mx-auto h-[190px] w-[190px] rounded-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-[240px] flex-col items-center justify-center text-center">
            <p className="text-sm font-medium">{emptyTitle}</p>
            {emptyHint && <p className="mt-1 max-w-xs text-xs text-dim">{emptyHint}</p>}
          </div>
        ) : (
          <>
            {/* The legend sits beside the ring whenever the card is wide enough
             * (~400px) and wraps underneath on narrow cards. The group centers
             * in any extra height from a taller grid row. */}
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-5">
              <div className="relative h-[190px] w-[190px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={rows}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={88}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {rows.map((row) => (
                        <Cell key={row.key} fill={row.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgb(var(--surface-elevated))',
                        border: '1px solid rgb(var(--border))',
                        borderRadius: 10,
                        fontSize: 12,
                        color: 'rgb(var(--foreground))',
                      }}
                      formatter={(value) => formatMoney(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex min-w-0 flex-col items-center justify-center px-4 text-center">
                  <span
                    className="max-w-full break-words font-bold leading-tight tabular-nums"
                    style={{ fontSize: `${fitTextSize(formatMoney(total), 96)}px` }}
                  >
                    {formatMoney(total)}
                  </span>
                  <span className="text-xs text-dim">{centerLabel}</span>
                </div>
              </div>

              <ul className="min-w-[12rem] flex-1 space-y-2.5">
                {rows.map((row) => (
                  <li key={row.key} className="flex items-center gap-2.5 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                      <CategoryIcon name={row.icon} className="h-3.5 w-3.5" />
                      {row.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-dim">{row.pct}%</span>
                    <span className="w-[5.5rem] shrink-0 whitespace-nowrap text-right font-medium tabular-nums">
                      {formatMoney(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
