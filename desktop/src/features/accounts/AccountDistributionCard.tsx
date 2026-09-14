import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { AccountWithBalance } from '@/lib/api';
import { KIND_CHART_COLORS, asAccountKind, isBalanceSheet } from './account-groups';

interface Props {
  accounts: AccountWithBalance[];
  loading: boolean;
}

interface Slice {
  kind: string;
  label: string;
  color: string;
  amount: number;
}

/**
 * Where the money sits: asset balances grouped by account kind (bank, cash,
 * investments). Assets with a zero or negative balance contribute nothing to
 * the split, so they are left out of the chart but the centre always shows the
 * real total.
 */
export function AccountDistributionCard({ accounts, loading }: Props) {
  const { t, formatMoney } = useI18n();

  const { slices, total } = React.useMemo(() => {
    const assets = accounts.filter((a) => isBalanceSheet(a) && a.type === 'asset');
    const byKind = new Map<string, Slice>();
    for (const account of assets) {
      const kind = asAccountKind(account.account_kind);
      const amount = parseFloat(account.balance) || 0;
      if (!kind || amount <= 0) continue;
      const existing = byKind.get(kind);
      if (existing) {
        existing.amount += amount;
      } else {
        byKind.set(kind, {
          kind,
          label: t(`accounts.kind.${kind}` as 'accounts.kind.bank'),
          color: KIND_CHART_COLORS[kind],
          amount,
        });
      }
    }
    const list = [...byKind.values()].sort((a, b) => b.amount - a.amount);
    const sum = assets.reduce((acc, a) => acc + Math.max(parseFloat(a.balance) || 0, 0), 0);
    return { slices: list, total: sum };
  }, [accounts, t]);

  const hasData = slices.length > 0 && total > 0;

  return (
    <Card className="flex h-full flex-col border-border bg-surface shadow-card">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="text-lg font-semibold">{t('accounts.distribution.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-5 pt-0">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="mx-auto h-[170px] w-[170px] rounded-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : !hasData ? (
          <p className="flex h-[220px] items-center justify-center text-center text-sm text-dim">
            {t('accounts.distribution.empty')}
          </p>
        ) : (
          <>
            <div className="relative h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="amount"
                    nameKey="label"
                    innerRadius={54}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {slices.map((slice) => (
                      <Cell key={slice.kind} fill={slice.color} />
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
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold tabular-nums">{formatMoney(total)}</span>
                <span className="text-xs text-dim">{t('accounts.summary.assets')}</span>
              </div>
            </div>

            <ul className="mt-4 space-y-2.5">
              {slices.map((slice) => (
                <li key={slice.kind} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-dim">
                    {Math.round((slice.amount / total) * 100)}%
                  </span>
                  <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                    {formatMoney(slice.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
