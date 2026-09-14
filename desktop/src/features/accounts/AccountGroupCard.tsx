import * as React from 'react';
import { ChevronDown, EllipsisVertical, Eye, Pencil, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { AccountWithBalance } from '@/lib/api';
import { accountAppearance, isCreditCard, type AccountGroupMeta } from './account-groups';

interface Props {
  meta: AccountGroupMeta;
  accounts: AccountWithBalance[];
  onView: (account: AccountWithBalance) => void;
  onEdit: (account: AccountWithBalance) => void;
  onDelete: (account: AccountWithBalance) => void;
}

/** Signed-magnitude display for a balance: assets positive, debts prefixed `-`. */
function formatBalance(account: AccountWithBalance, formatMoney: (v: number) => string): string {
  const balance = parseFloat(account.balance) || 0;
  return account.type === 'liability'
    ? `- ${formatMoney(Math.abs(balance))}`
    : formatMoney(balance);
}

/**
 * One group of accounts (bank / cards & loans / investments / other) with its
 * collapsible header, group total and account rows.
 *
 * Rendered as a section rather than its own card: the accounts screen wraps the
 * filters and every group inside a single box, so the groups only draw the
 * dividers between them.
 */
export function AccountGroupCard({ meta, accounts, onView, onEdit, onDelete }: Props) {
  const { t, formatMoney } = useI18n();
  const [open, setOpen] = React.useState(true);
  const total = accounts.reduce((sum, a) => sum + Math.abs(parseFloat(a.balance) || 0), 0);
  const isLiabilityGroup = meta.key === 'liabilities';
  const countKey =
    accounts.length === 1 ? 'accounts.group.count_one' : 'accounts.group.count_other';

  return (
    <section className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 bg-primary/[0.03] px-4 py-3.5 text-left transition-colors hover:bg-primary/[0.06]"
      >
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', meta.tone)}>
          <meta.icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{t(meta.titleKey)}</span>
          <span className="block truncate text-xs text-dim">{t(meta.blurbKey)}</span>
        </span>
        <span className="shrink-0 text-right">
          <span
            className={cn(
              'block text-sm font-semibold tabular-nums',
              isLiabilityGroup && total > 0 ? 'text-danger' : 'text-foreground',
            )}
          >
            {isLiabilityGroup ? `- ${formatMoney(total)}` : formatMoney(total)}
          </span>
          <span className="block text-xs text-dim">{t(countKey, { count: accounts.length })}</span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-dim transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul className="divide-y divide-border/60">
          {accounts.map((account) => {
            const appearance = accountAppearance(account);
            const balance = parseFloat(account.balance) || 0;
            const isLiability = account.type === 'liability';

            const metaParts: string[] = [];
            if (appearance.kindKey) metaParts.push(t(appearance.kindKey));
            if (isCreditCard(account)) {
              if (account.closing_day) {
                metaParts.push(t('accounts.meta.cardCloses', { day: account.closing_day }));
              }
              if (account.due_day) {
                metaParts.push(t('accounts.meta.cardDue', { day: account.due_day }));
              }
            }
            if (account.credit_limit) {
              metaParts.push(t('common.limit', { amount: formatMoney(account.credit_limit) }));
            }

            return (
              <li key={account.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onView(account)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onView(account);
                    }
                  }}
                  className="group flex min-h-[64px] cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
                      appearance.tone,
                    )}
                  >
                    <appearance.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{account.name}</span>
                    {metaParts.length > 0 && (
                      <span className="mt-0.5 block truncate text-xs text-dim">
                        {metaParts.join(' · ')}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-semibold tabular-nums',
                      balance === 0
                        ? 'text-foreground'
                        : isLiability
                          ? 'text-danger'
                          : 'text-success',
                    )}
                  >
                    {formatBalance(account, formatMoney)}
                  </span>
                  <span onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          aria-label={t('accounts.action.view')}
                        >
                          <EllipsisVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onView(account)}>
                          <Eye className="h-4 w-4" />
                          {t('accounts.action.view')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(account)}>
                          <Pencil className="h-4 w-4" />
                          {t('common.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDelete(account)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                          {t('common.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
