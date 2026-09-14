import { Link } from 'react-router-dom';
import { ArrowRight, Plus, ReceiptText } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { categoryIcon } from '@shared/category-icons';
import { cn } from '@/lib/utils';
import type { AccountWithBalance, Category, Transaction } from '@/lib/api';

interface RecentTransactionsCardProps {
  transactions: Transaction[];
  categoryById: Map<string, Category>;
  accountById: Map<string, AccountWithBalance>;
  loading: boolean;
}

/** Latest activity for the selected month, with category and account context. */
export function RecentTransactionsCard({
  transactions,
  categoryById,
  accountById,
  loading,
}: RecentTransactionsCardProps) {
  const { t, formatMoney, formatDate } = useI18n();

  return (
    <Card className="flex h-full flex-col border-border bg-surface shadow-card">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-5 pb-2">
        <CardTitle className="text-lg font-semibold">
          {t('dashboard.recentTransactions')}
        </CardTitle>
        <Link
          to="/transactions"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t('dashboard.viewAll')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>

      <CardContent className="flex-1 p-0 pb-1">
        {loading ? (
          <div className="space-y-2 px-5 py-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<ReceiptText className="h-6 w-6" />}
              title={t('dashboard.noTransactionsTitle')}
              description={t('dashboard.noTransactionsDesc')}
              action={
                <Button asChild>
                  <Link to="/transactions?add=1">
                    <Plus className="h-4 w-4" />
                    {t('dashboard.quickActions.addTransaction')}
                  </Link>
                </Button>
              }
            />
          </div>
        ) : (
          <ul>
            {transactions.map((tx) => {
              const category = tx.category_id ? categoryById.get(tx.category_id) : undefined;
              const account = tx.account_id ? accountById.get(tx.account_id) : undefined;
              const isIncome = tx.type === 'income';
              return (
                <li
                  key={tx.id}
                  className="flex items-center gap-3 border-b border-border/60 px-5 py-3 last:border-b-0"
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-base',
                      isIncome ? 'bg-success/15' : 'bg-danger/15',
                    )}
                  >
                    {category?.icon ? categoryIcon(category.icon) : '•'}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tx.description}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-dim">
                      <span>
                        {formatDate(tx.date)}
                        {tx.card_due_date &&
                          tx.card_due_date !== tx.date &&
                          ` · ${t('transactions.billDue', { date: formatDate(tx.card_due_date) })}`}
                      </span>
                      {category && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="max-w-[10rem] truncate">{category.name}</span>
                        </>
                      )}
                      {account && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="max-w-[10rem] truncate">{account.name}</span>
                        </>
                      )}
                      {tx.installment_plan_id && (
                        <Badge variant="secondary">{t('transactions.installment')}</Badge>
                      )}
                    </p>
                  </div>

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
