import * as React from 'react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { payCardBill, type AccountWithBalance, type CardBill, type PayCardBillRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: AccountWithBalance | null;
  bill: CardBill | null;
  sourceAccounts: AccountWithBalance[];
  onSaved: () => void;
}

/** Dialog for applying a full or partial payment to a selected card bill. */
export function PayCardBillDialog({ open, onOpenChange, card, bill, sourceAccounts, onSaved }: Props) {
  const { t, formatMoney, formatDate } = useI18n();
  const { toast } = useToast();
  const [amount, setAmount] = React.useState('');
  const [sourceAccountId, setSourceAccountId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const defaultSource = React.useMemo(
    () => sourceAccounts.find((account) => account.name.trim().toLowerCase() === 'cash'),
    [sourceAccounts],
  );

  React.useEffect(() => {
    if (!open) return;
    setAmount(bill?.remaining_amount ?? '');
    setSourceAccountId(defaultSource?.id ?? '');
    setError(null);
  }, [bill, defaultSource, open]);

  const selectedSource = sourceAccounts.find((account) => account.id === sourceAccountId) ?? null;

  const handleSubmit = async () => {
    if (!card || !bill) return;
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (!(amountNum > 0)) {
      setError(t('creditCards.validation.amount'));
      return;
    }

    setSaving(true);
    setError(null);
    const payload: PayCardBillRequest = {
      bill_id: bill.id,
      amount: amount.replace(',', '.'),
      from_account_id: sourceAccountId || null,
    };
    try {
      const result = await payCardBill(card.id, bill.id, payload);
      onOpenChange(false);
      onSaved();
      toast({
        title: t('creditCards.billPaid', {
          amount: formatMoney(result.amount_paid),
          remaining: formatMoney(result.remaining),
        }),
        variant: 'success',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('creditCards.failedPay'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('creditCards.payModalTitle')}</DialogTitle>
          <DialogDescription>
            {card && bill
              ? `${card.name} · ${t('creditCards.bill', { amount: formatMoney(bill.total_amount) })}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {!bill ? (
          <p className="py-4 text-sm text-dim">{t('creditCards.noOpenBill')}</p>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">{t('creditCards.payAmountHint')}</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={formatMoney(bill.remaining_amount)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-source">{t('creditCards.fromAccount')}</Label>
              <select
                id="pay-source"
                className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={sourceAccountId}
                onChange={(event) => setSourceAccountId(event.target.value)}
              >
                <option value="">{t('accounts.transfer.selectAccount')}</option>
                {sourceAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <p>
                {t('creditCards.paySummary', {
                  amount: formatMoney(amount || bill.remaining_amount),
                  account: selectedSource?.name ?? t('creditCards.defaultCash'),
                })}
              </p>
              <p className="mt-1">
                {t('common.due', { date: formatDate(bill.due_date) })} ·{' '}
                {formatMoney(bill.remaining_amount)} {t('common.remaining')}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !bill}>
            {saving ? t('common.saving') : t('creditCards.pay')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}