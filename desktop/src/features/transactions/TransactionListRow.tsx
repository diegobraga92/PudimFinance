import { MoreVertical, Pencil, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import type { Category, Transaction } from '@/lib/api';
import { categoryIcon } from '@shared/category-icons';
import { accountIcon } from '@shared/account-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface Props {
  tx: Transaction;
  category?: Category;
  /** Account name for the second line, when the transaction has one. */
  accountName?: string;
  accountIconName?: string | null;
  accountKind?: string | null;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Phone-sized transaction row: category icon, description, account/date and the
 * signed amount, with edit/delete behind an overflow menu.
 */
export function TransactionListRow({ tx, category, accountName, accountIconName, accountKind, onEdit, onDelete }: Props) {
  const { t, formatMoney, formatDate } = useI18n();
  const isIncome = tx.type === 'income';

  return (
    <li className="flex items-stretch">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-surface-hover"
      >
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base',
            isIncome ? 'bg-success/15' : 'bg-danger/15',
          )}
        >
          {category?.icon ? categoryIcon(category.icon) : isIncome ? '↑' : '↓'}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{tx.description}</span>
          <span className="mt-0.5 block truncate text-xs text-dim">
            <>
              {accountName && (
                <span>
                  {accountIcon(accountIconName, accountKind)} {accountName}
                  {(category?.name || tx.date) && ' · '}
                </span>
              )}
              {[category?.name, formatDate(tx.date)].filter(Boolean).join(' · ')}
            </>
          </span>
        </span>

        <span
          className={cn(
            'shrink-0 text-sm font-semibold tabular-nums',
            isIncome ? 'text-income' : 'text-expense',
          )}
        >
          {isIncome ? '+' : '-'}
          {formatMoney(tx.amount)}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-11 shrink-0 rounded-none text-muted-foreground"
            aria-label={t('transactions.table.actions')}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit} className="gap-2">
            <Pencil className="h-4 w-4" />
            {t('common.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
