import * as React from 'react';
import { TrendingUp } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { AccountWithBalance } from '@/lib/api';
import { asAccountKind } from './account-groups';

interface Props {
  /** Balance-sheet accounts; only investment kinds are listed. */
  accounts: AccountWithBalance[];
  loading: boolean;
}

/**
 * Investments sidebar card: each investment account as a row (name, value,
 * share of the portfolio and a bar for that share), biggest first.
 */
export function InvestmentsSummaryCard({ accounts, loading }: Props) {
  const { t, formatMoney } = useI18n();

  const { rows, total } = React.useMemo(() => {
    const amounts = accounts
      .filter((account) => asAccountKind(account.account_kind) === 'investment')
      .map((account) => ({
        id: account.id,
        name: account.name,
        amount: parseFloat(account.balance) || 0,
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const sum = amounts.reduce((acc, row) => acc + row.amount, 0);
    return {
      rows: amounts.map((row) => ({
        ...row,
        pct: sum > 0 ? Math.round((row.amount / sum) * 100) : 0,
      })),
      total: sum,
    };
  }, [accounts]);

  return (
    <Card className="border-border bg-surface shadow-card">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 p-5 pb-3">
        <CardTitle className="text-base font-semibold">{t('accounts.investments.title')}</CardTitle>
        {!loading && rows.length > 0 && (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-success">
            {formatMoney(total)}
          </span>
        )}
      </CardHeader>

      <CardContent className="p-5 pt-0">
        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-dim">{t('accounts.investments.empty')}</p>
        ) : (
          <ul className="space-y-3.5">
            {rows.map((row) => (
              <li key={row.id} className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4 shrink-0 text-success" />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatMoney(row.amount)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={Math.min(row.pct, 100)}
                    className="h-1.5 flex-1"
                    indicatorClassName="bg-success"
                  />
                  <span className="w-9 shrink-0 text-right text-xs tabular-nums text-dim">
                    {row.pct}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
