import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/app/i18n';
import {
  fetchMonthlyReport,
  fetchTransactions,
  type Category,
} from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Number of months shown in the per-account monthly summary. */
const SUMMARY_MONTHS = 12;

/** Minimal account shape that works for both `AccountWithBalance` and `CardOverview`. */
export interface AccountLike {
  id: string;
  name: string;
  type?: string;
  account_kind?: string | null;
}

interface Props {
  account: AccountLike;
  categories: Category[];
  open: boolean;
  onClose: () => void;
}


/** Modal with the last 12 months of activity and recent transactions for an account. */
export function AccountDetail({ account, categories, open, onClose }: Props) {
  const { t, formatMoney, formatDate, monthNames } = useI18n();
  const categoryById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const now = React.useMemo(() => new Date(), []);
  const range = React.useMemo(() => {
    const start = new Date(now.getFullYear(), now.getMonth() - (SUMMARY_MONTHS - 1), 1);
    return {
      startYear: start.getFullYear(),
      startMonth: start.getMonth() + 1,
      endYear: now.getFullYear(),
      endMonth: now.getMonth() + 1,
    };
  }, [now]);

  const reportQuery = useQuery({
    queryKey: ['account-report', account.id, range],
    queryFn: () =>
      fetchMonthlyReport(
        range.startYear,
        range.startMonth,
        range.endYear,
        range.endMonth,
        account.id,
      ),
    enabled: open,
  });
  const txQuery = useQuery({
    queryKey: ['account-tx', account.id],
    queryFn: () => fetchTransactions({ account_id: account.id, page_size: 200 }),
    enabled: open,
  });

  const loading = reportQuery.isLoading || txQuery.isLoading;
  const error = reportQuery.error ?? txQuery.error;
  const monthsDesc = reportQuery.data ? [...reportQuery.data.months].reverse() : [];
  const transactions = txQuery.data?.items ?? [];
  const hasActivity = monthsDesc.some(
    (m) => parseFloat(m.income_total) !== 0 || parseFloat(m.expense_total) !== 0,
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('accounts.detail.title', { name: account.name })}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('accounts.detail.lastMonths', { count: SUMMARY_MONTHS })}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : t('accounts.detail.failedLoad')}
          </p>
        ) : (
          <div className="space-y-6">
            <section>
              <h4 className="mb-2 text-sm font-semibold">{t('accounts.detail.monthlySummary')}</h4>
              {!hasActivity ? (
                <p className="text-sm text-dim">{t('accounts.detail.noMonthlyData')}</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="grid grid-cols-4 gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <span>{t('reports.month')}</span>
                    <span className="text-right">{t('reports.income')}</span>
                    <span className="text-right">{t('reports.expenses')}</span>
                    <span className="text-right">{t('reports.netShort')}</span>
                  </div>
                  {monthsDesc.map((m) => {
                    const net = parseFloat(m.balance);
                    return (
                      <div
                        key={`${m.year}-${m.month}`}
                        className="grid grid-cols-4 gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
                      >
                        <span className="text-muted-foreground">
                          {monthNames[m.month - 1]} {m.year}
                        </span>
                        <span className="text-right tabular-nums text-income">
                          {formatMoney(m.income_total)}
                        </span>
                        <span className="text-right tabular-nums text-expense">
                          {formatMoney(m.expense_total)}
                        </span>
                        <span
                          className={cn(
                            'text-right font-medium tabular-nums',
                            net >= 0 ? 'text-income' : 'text-expense',
                          )}
                        >
                          {formatMoney(net)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold">{t('accounts.detail.transactions')}</h4>
              {transactions.length === 0 ? (
                <p className="text-sm text-dim">{t('accounts.detail.noTransactions')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {transactions.map((tx) => {
                    const cat = tx.category_id ? categoryById.get(tx.category_id) : undefined;
                    const isIncome = tx.type === 'income';
                    return (
                      <li key={tx.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="w-20 shrink-0 text-muted-foreground">
                          {formatDate(tx.date)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {tx.description}
                          {cat && <span className="ml-1.5 text-dim">· {cat.name}</span>}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 tabular-nums',
                            isIncome ? 'text-income' : 'text-expense',
                          )}
                        >
                          {isIncome ? '+' : '-'}
                          {formatMoney(tx.amount)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

