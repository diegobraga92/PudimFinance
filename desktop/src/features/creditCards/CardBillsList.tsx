import { Wallet } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import type { CardBill } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

interface Props {
  bills: CardBill[];
  loading: boolean;
  onPay: (bill: CardBill) => void;
}

/** Billing-cycle history for a card, with a direct action for every open bill. */
export function CardBillsList({ bills, loading, onPay }: Props) {
  const { t, formatMoney, formatDate } = useI18n();

  if (loading) {
    return <div className="h-32 animate-pulse rounded-md bg-muted/60" />;
  }

  if (bills.length === 0) {
    return <p className="py-6 text-center text-sm text-dim">{t('creditCards.noCycles')}</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {bills.map((bill) => {
        const open = bill.status === 'open';
        return (
          <li key={bill.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {t('creditCards.periodRange', {
                  start: formatDate(bill.period_start),
                  end: formatDate(bill.period_end),
                })}
              </p>
              <p className="text-xs text-dim">
                {t('common.due', { date: formatDate(bill.due_date) })} ·{' '}
                {open ? t('common.open') : t('common.paid')}
              </p>
            </div>
            <Badge variant={open ? 'warning' : 'income'}>
              {open ? t('common.pending') : t('common.paid')}
            </Badge>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">{formatMoney(bill.total_amount)}</p>
              {open && (
                <p className="text-xs text-dim">
                  {formatMoney(bill.remaining_amount)} {t('common.remaining')}
                </p>
              )}
            </div>
            {open && (
              <Button variant="outline" size="sm" onClick={() => onPay(bill)}>
                <Wallet className="h-4 w-4" />
                {t('creditCards.pay')}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}