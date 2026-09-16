import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Wallet } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  fetchCard,
  fetchCardBills,
  fetchSettings,
  updateSettings,
  type AccountWithBalance,
  type CardBill,
  type CardExpenseDating,
} from '@/lib/api';
import { CardBillsList } from './CardBillsList';

const DATING_DEPENDENT_QUERIES = [
  'summary',
  'transactions',
  'budget-summary',
  'dashboard-cash-flow',
  'report-overview',
  'report-breakdown',
  'report-trends',
];

const DATING_OPTIONS: {
  value: CardExpenseDating;
  labelKey: 'creditCards.dating.purchase' | 'creditCards.dating.due';
  hintKey: 'creditCards.dating.purchaseHint' | 'creditCards.dating.dueHint';
}[] = [
  {
    value: 'purchase_date',
    labelKey: 'creditCards.dating.purchase',
    hintKey: 'creditCards.dating.purchaseHint',
  },
  {
    value: 'due_date',
    labelKey: 'creditCards.dating.due',
    hintKey: 'creditCards.dating.dueHint',
  },
];

interface Props {
  account: AccountWithBalance;
  open: boolean;
  initialAction?: 'pay' | null;
  onPurchase: () => void;
  onPay: (bill: CardBill) => void;
  onAnticipate: (bill: CardBill | null) => void;
}

/**
 * Card-only workspace embedded in the account detail dialog. It owns card
 * queries and presents bills/actions without introducing another page.
 */
export function CardAccountSection({ account, open, initialAction, onPurchase, onPay, onAnticipate }: Props) {
  const { t, formatMoney, formatDate } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [savingDating, setSavingDating] = React.useState(false);
  const autoActionHandled = React.useRef(false);

  const cardQuery = useQuery({
    queryKey: ['card', account.id],
    queryFn: () => fetchCard(account.id),
    enabled: open,
  });
  const billsQuery = useQuery({
    queryKey: ['card-bills', account.id],
    queryFn: () => fetchCardBills(account.id),
    enabled: open,
  });
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => fetchSettings(), enabled: open });

  const card = cardQuery.data;
  const currentBill = card?.current_bill ?? null;
  const dating: CardExpenseDating =
    settingsQuery.data?.card_expense_dating === 'due_date' ? 'due_date' : 'purchase_date';

  React.useEffect(() => {
    if (
      !autoActionHandled.current &&
      open &&
      initialAction === 'pay' &&
      currentBill?.status === 'open'
    ) {
      autoActionHandled.current = true;
      onPay(currentBill);
    }
  }, [currentBill, initialAction, onPay, open]);

  React.useEffect(() => {
    if (!open) autoActionHandled.current = false;
  }, [open]);

  const changeDating = async (value: CardExpenseDating) => {
    if (value === dating) return;
    setSavingDating(true);
    try {
      const saved = await updateSettings({ card_expense_dating: value });
      queryClient.setQueryData(['settings'], saved);
      for (const key of DATING_DEPENDENT_QUERIES) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast({ title: t('creditCards.dating.saved'), variant: 'success' });
    } catch (err) {
      toast({
        title: t('creditCards.dating.failed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      });
    } finally {
      setSavingDating(false);
    }
  };

  if (cardQuery.isLoading || billsQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (cardQuery.error || billsQuery.error || !card) {
    return (
      <p className="text-sm text-destructive">
        {cardQuery.error instanceof Error
          ? cardQuery.error.message
          : billsQuery.error instanceof Error
            ? billsQuery.error.message
            : t('creditCards.failedLoad')}
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('creditCards.currentBill')}</CardTitle>
          <CardDescription>
            {currentBill
              ? `${t('common.due', { date: formatDate(currentBill.due_date) })} · ${t('creditCards.currentOpenBill')}`
              : t('creditCards.noOpenBill')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatMoney(currentBill?.remaining_amount ?? '0')}
              </p>
              <p className="text-xs text-dim">{t('common.remaining')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onPurchase}>
                <Plus className="h-4 w-4" />
                {t('creditCards.purchase')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => currentBill && onPay(currentBill)}
                disabled={!currentBill || currentBill.status !== 'open'}
              >
                <Wallet className="h-4 w-4" />
                {t('creditCards.payBill')}
              </Button>
              <Button size="sm" onClick={() => onAnticipate(currentBill)}>
                <CalendarClock className="h-4 w-4" />
                {t('creditCards.anticipateShort')}
              </Button>
            </div>
          </div>
          {card.credit_limit && (
            <p className="text-xs text-dim">{t('common.limit', { amount: formatMoney(card.credit_limit) })}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('creditCards.billingCycles')}</CardTitle>
          <CardDescription>{card.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <CardBillsList bills={billsQuery.data ?? []} loading={false} onPay={onPay} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('creditCards.dating.title')}</p>
            <p className="mt-1 text-xs text-dim">{t('creditCards.dating.globalDesc')}</p>
          </div>
          <div
            role="radiogroup"
            aria-label={t('creditCards.dating.title')}
            className="flex shrink-0 gap-1 rounded-md bg-muted p-1"
          >
            {DATING_OPTIONS.map((option) => {
              const active = dating === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={settingsQuery.isLoading || settingsQuery.isError || savingDating}
                  onClick={() => void changeDating(option.value)}
                  title={t(option.hintKey)}
                  className={cn(
                    'rounded-sm px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    active
                      ? 'bg-surface text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}