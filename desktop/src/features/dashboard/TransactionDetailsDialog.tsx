import * as React from 'react';
import { Pencil } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AccountIcon } from '@/components/AccountIcon';
import { CategoryIcon } from '@/components/CategoryIcon';
import { cn } from '@/lib/utils';
import type { AccountWithBalance, Category, Transaction } from '@/lib/api';

interface TransactionDetailsDialogProps {
  /** Transaction to inspect, or `null` while the dialog is closed. */
  transaction: Transaction | null;
  category?: Category;
  account?: AccountWithBalance;
  onOpenChange: (open: boolean) => void;
  /** Switches to the edit form. */
  onEdit: () => void;
}

/** One label/value pair inside the details list. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

/**
 * Read-only summary of a single transaction, opened from the dashboard's
 * activity table. The Edit button hands the same transaction to
 * `TransactionForm`, so viewing and changing share one source of truth.
 */
export function TransactionDetailsDialog({
  transaction,
  category,
  account,
  onOpenChange,
  onEdit,
}: TransactionDetailsDialogProps) {
  const { t, formatMoney, formatDate } = useI18n();
  const isIncome = transaction?.type === 'income';

  return (
    <Dialog open={transaction !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dashboard.transactionDetails')}</DialogTitle>
          <DialogDescription>
            {transaction ? formatDate(transaction.date) : ''}
          </DialogDescription>
        </DialogHeader>

        {transaction && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg',
                  isIncome ? 'bg-success/15' : 'bg-danger/15',
                )}
              >
                <CategoryIcon name={category?.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{transaction.description}</p>
                <p
                  className={cn(
                    'mt-0.5 text-lg font-bold tabular-nums',
                    isIncome ? 'text-income' : 'text-expense',
                  )}
                >
                  {isIncome ? '+' : '-'}
                  {formatMoney(transaction.amount)}
                </p>
              </div>
              <Badge variant={isIncome ? 'income' : 'expense'}>
                {isIncome ? t('common.income') : t('common.expense')}
              </Badge>
            </div>

            <dl className="divide-y divide-border/60 rounded-md border border-border">
              <DetailRow label={t('common.date')}>
                {formatDate(transaction.date)}
                {transaction.card_due_date && transaction.card_due_date !== transaction.date && (
                  <span className="block text-xs text-dim">
                    {t('transactions.billDue', { date: formatDate(transaction.card_due_date) })}
                  </span>
                )}
              </DetailRow>
              <DetailRow label={t('common.category')}>
                {category ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CategoryIcon name={category.icon} className="h-4 w-4" />
                    <span>{category.name}</span>
                  </span>
                ) : (
                  <span className="text-dim">{t('common.none')}</span>
                )}
              </DetailRow>
              <DetailRow label={t('dashboard.accountCard')}>
                {account ? (
                  <span className="inline-flex items-center gap-1.5">
                    <AccountIcon name={account.icon} kind={account.account_kind} className="h-4 w-4" />
                    <span>{account.name}</span>
                  </span>
                ) : (
                  <span className="text-dim">{t('common.none')}</span>
                )}
              </DetailRow>
              {transaction.installment_plan_id && (
                <DetailRow label={t('transactions.form.installments')}>
                  {t('transactions.installment')}
                </DetailRow>
              )}
              {transaction.notes && (
                <DetailRow label={t('common.notes')}>
                  <span className="whitespace-pre-wrap">{transaction.notes}</span>
                </DetailRow>
              )}
            </dl>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button type="button" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            {t('common.edit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
