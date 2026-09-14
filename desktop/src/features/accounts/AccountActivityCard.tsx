import { Link } from 'react-router-dom';
import { ArrowRight, ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryIcon } from '@shared/category-icons';
import { cn } from '@/lib/utils';
import type { AccountWithBalance, Category, Transaction } from '@/lib/api';

interface Props {
  transactions: Transaction[];
  accountById: Map<string, AccountWithBalance>;
  categoryById: Map<string, Category>;
  loading: boolean;
}

/** Latest money movement, with the account it belongs to. */
export function AccountActivityCard({
  transactions,
  accountById,
  categoryById,
  loading,
}: Props) {
  const { t, formatMoney, formatDate } = useI18n();

  return (
    <Card className="flex h-full flex-col border-border bg-surface shadow-card">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-5 pb-3">
        <CardTitle className="text-lg font-semibold">{t('accounts.activity.title')}</CardTitle>
        <Link
          to="/transactions"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t('dashboard.viewAll')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>

      <CardContent className="flex-1 p-5 pt-0">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-[34px] w-[34px] rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <p className="flex h-[180px] items-center justify-center text-center text-sm text-dim">
            {t('accounts.activity.empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {transactions.map((tx) => {
              const category = tx.category_id ? categoryById.get(tx.category_id) : undefined;
              const account = tx.account_id ? accountById.get(tx.account_id) : undefined;
              const isIncome = tx.type === 'income';
              return (
                <li key={tx.id} className="flex min-h-[54px] items-center gap-3 py-1.5">
                  <span
                    className={cn(
                      'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md text-sm',
                      isIncome ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
                    )}
                  >
                    {category?.icon ? (
                      categoryIcon(category.icon)
                    ) : isIncome ? (
                      <ArrowDownLeft className="h-4 w-4" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{tx.description}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-dim">
                      <Wallet className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {account?.name ?? category?.name ?? t('accounts.activity.noAccount')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{formatDate(tx.date)}</span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-semibold tabular-nums',
                      isIncome ? 'text-success' : 'text-danger',
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
      </CardContent>
    </Card>
  );
}
