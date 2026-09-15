import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, ReceiptText } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState';
import { TransactionForm } from '@/features/transactions/TransactionForm';
import { categoryIcon } from '@shared/category-icons';
import { accountIcon } from '@shared/account-icons';
import { cn } from '@/lib/utils';
import type { AccountWithBalance, Category, Transaction } from '@/lib/api';
import { TransactionDetailsDialog } from './TransactionDetailsDialog';

interface RecentTransactionsCardProps {
  transactions: Transaction[];
  categoryById: Map<string, Category>;
  accountById: Map<string, AccountWithBalance>;
  loading: boolean;
}

/**
 * Latest activity for the selected month as a table (date, category,
 * description, account/card, amount). Clicking a row opens a details dialog
 * that can hand the transaction over to the edit form.
 */
export function RecentTransactionsCard({
  transactions,
  categoryById,
  accountById,
  loading,
}: RecentTransactionsCardProps) {
  const { t, formatMoney, formatDate } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selected, setSelected] = React.useState<Transaction | null>(null);
  const [editing, setEditing] = React.useState<Transaction | null>(null);

  // The edit form needs the full collections, but the card only receives
  // lookups — rebuilding the arrays here keeps the dashboard's props stable.
  const categories = React.useMemo(() => [...categoryById.values()], [categoryById]);
  const accounts = React.useMemo(() => [...accountById.values()], [accountById]);

  const handleSaved = () => {
    setEditing(null);
    // Summary, budgets, cash flow and the activity list all derive from it.
    void queryClient.invalidateQueries();
    toast({ title: t('transactions.saved'), variant: 'success' });
  };

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
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 flex-1" />
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
          <Table className="[&_td:first-child]:pl-5 [&_th:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:last-child]:pr-5">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('common.date')}</TableHead>
                <TableHead>{t('common.category')}</TableHead>
                <TableHead>{t('common.description')}</TableHead>
                <TableHead>{t('dashboard.accountCard')}</TableHead>
                <TableHead className="text-right">{t('common.amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => {
                const category = tx.category_id ? categoryById.get(tx.category_id) : undefined;
                const account = tx.account_id ? accountById.get(tx.account_id) : undefined;
                const isIncome = tx.type === 'income';
                return (
                  <TableRow key={tx.id} onClick={() => setSelected(tx)} className="cursor-pointer">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(tx.date)}
                      {tx.card_due_date && tx.card_due_date !== tx.date && (
                        <span className="block text-[11px] text-dim">
                          {t('transactions.billDue', { date: formatDate(tx.card_due_date) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {category ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span className="text-base">{categoryIcon(category.icon)}</span>
                          <span className="max-w-[9rem] truncate">{category.name}</span>
                        </span>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(tx)}
                          className="min-w-0 truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {tx.description}
                        </button>
                        {tx.installment_plan_id && (
                          <Badge variant="secondary" className="shrink-0">
                            {t('transactions.installment')}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {account ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-base">{accountIcon(account.icon, account.account_kind)}</span>
                          <span>{account.name}</span>
                        </span>
                      ) : <span className="text-dim">—</span>}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'whitespace-nowrap text-right text-sm font-semibold tabular-nums',
                        isIncome ? 'text-income' : 'text-expense',
                      )}
                    >
                      {isIncome ? '+' : '-'}
                      {formatMoney(tx.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Click-through: details first, then the shared edit form. */}
      <TransactionDetailsDialog
        transaction={selected}
        category={selected?.category_id ? categoryById.get(selected.category_id) : undefined}
        account={selected?.account_id ? accountById.get(selected.account_id) : undefined}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onEdit={() => {
          setEditing(selected);
          setSelected(null);
        }}
      />

      <TransactionForm
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        categories={categories}
        accounts={accounts}
        editing={editing}
        onSaved={handleSaved}
      />
    </Card>
  );
}
