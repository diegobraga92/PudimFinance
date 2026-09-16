import * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/CategoryIcon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { Category, Transaction } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  loading: boolean;
  error: unknown;
}

function TransactionTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="space-y-3 p-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Read-only account transactions table with a compact phone layout. */
export function AccountTransactionsTable({ transactions, categories, loading, error }: Props) {
  const { t, formatMoney, formatDate } = useI18n();
  const categoryById = React.useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);

  if (loading) return <TransactionTableSkeleton />;

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('accounts.detail.failedLoad')}
      </p>
    );
  }

  if (transactions.length === 0) {
    return <p className="text-sm text-dim">{t('accounts.detail.noTransactions')}</p>;
  }

  return (
    <div className="max-h-[46vh] overflow-auto rounded-lg border border-border">
      <Table className="min-w-0 table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[6.5rem] whitespace-nowrap px-2 sm:w-[7.5rem] sm:px-3">
              {t('transactions.table.date')}
            </TableHead>
            <TableHead className="hidden w-[9rem] md:table-cell">{t('transactions.table.category')}</TableHead>
            <TableHead className="px-2 sm:px-3">{t('transactions.table.description')}</TableHead>
            <TableHead className="w-[6rem] whitespace-nowrap px-2 text-right sm:w-[6.5rem] sm:px-3">
              {t('transactions.table.amount')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx) => {
            const category = tx.category_id ? categoryById.get(tx.category_id) : undefined;
            const isIncome = tx.type === 'income';
            const DirectionIcon = isIncome ? ArrowUpRight : ArrowDownRight;
            return (
              <TableRow key={tx.id}>
                <TableCell className="whitespace-nowrap px-2 align-top text-xs text-muted-foreground sm:px-3 sm:text-sm">
                  <span className="block">{formatDate(tx.date)}</span>
                  {tx.card_due_date && tx.card_due_date !== tx.date && (
                    <span className="mt-0.5 block text-[11px] text-dim">
                      {t('transactions.billDue', { date: formatDate(tx.card_due_date) })}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {category ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <CategoryIcon name={category.icon} className="h-4 w-4" />
                      <span className="truncate text-sm">{category.name}</span>
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </TableCell>
                <TableCell className="min-w-0 px-2 align-top sm:px-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <CategoryIcon name={category?.icon} className="mt-0.5 h-4 w-4 shrink-0 md:hidden" />
                    <div className="min-w-0">
                      <span className="block truncate font-medium">{tx.description}</span>
                      {category && (
                        <span className="mt-0.5 block truncate text-xs text-dim md:hidden">{category.name}</span>
                      )}
                      {tx.installment_plan_id && (
                        <Badge variant="secondary" className="mt-1">
                          {t('transactions.installment')}
                        </Badge>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell
                  className={cn(
                    'whitespace-nowrap px-2 text-right align-top font-semibold tabular-nums sm:px-3',
                    isIncome ? 'text-income' : 'text-expense',
                  )}
                >
                  <span className="inline-flex items-center justify-end gap-0.5">
                    <DirectionIcon className="h-3.5 w-3.5" />
                    {isIncome ? '+' : '-'}
                    {formatMoney(tx.amount)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}