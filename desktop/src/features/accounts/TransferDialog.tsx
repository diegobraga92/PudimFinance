import * as React from 'react';

import { useI18n } from '@/app/i18n';
import { DateField } from '@/components/DateField';
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
import { createLedgerTransaction, type AccountWithBalance } from '@/lib/api';
import { toIsoDate } from '@/lib/date-input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Balance-sheet accounts the money can move between. */
  accounts: AccountWithBalance[];
  onSaved: () => void;
}

/** Transfers money between balance-sheet accounts without affecting totals. */
export function TransferDialog({ open, onOpenChange, accounts, onSaved }: Props) {
  const { t } = useI18n();

  const [fromId, setFromId] = React.useState('');
  const [toId, setToId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFromId(accounts[0]?.id ?? '');
    setToId(accounts[1]?.id ?? '');
    setAmount('');
    setDate(toIsoDate(new Date()));
    setDescription('');
    setError(null);
    setSaving(false);
  }, [open, accounts]);

  const enoughAccounts = accounts.length >= 2;
  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = amount.trim().replace(',', '.');
    const numeric = Number.parseFloat(normalized);

    if (!fromId || !toId) {
      setError(t('accounts.transfer.selectAccount'));
      return;
    }
    if (fromId === toId) {
      setError(t('accounts.transfer.sameAccount'));
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError(t('quickAdd.amountError'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const label =
        description.trim() ||
        `${t('accounts.transfer')}: ${from?.name ?? ''} → ${to?.name ?? ''}`;
      // The ledger groups entries by `transaction_id` and labels the group with
      // the first entry's description, so both entries carry the transfer text
      // (direction is still visible from which side is debited).
      await createLedgerTransaction({
        description: label,
        date,
        entries: [
          {
            account_id: toId,
            debit_amount: normalized,
            credit_amount: '0',
            description: label,
          },
          {
            account_id: fromId,
            debit_amount: '0',
            credit_amount: normalized,
            description: label,
          },
        ],
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('accounts.transfer.failed'));
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:[color-scheme:dark]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('accounts.transfer.title')}</DialogTitle>
          <DialogDescription>{t('accounts.transfer.desc')}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {!enoughAccounts && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              {t('accounts.transfer.needTwo')}
            </p>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="transfer-from">{t('accounts.transfer.from')}</Label>
            <select
              id="transfer-from"
              className={selectClass}
              value={fromId}
              onChange={(event) => setFromId(event.target.value)}
              disabled={!enoughAccounts}
            >
              <option value="">{t('accounts.transfer.selectAccount')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-to">{t('accounts.transfer.to')}</Label>
            <select
              id="transfer-to"
              className={selectClass}
              value={toId}
              onChange={(event) => setToId(event.target.value)}
              disabled={!enoughAccounts}
            >
              <option value="">{t('accounts.transfer.selectAccount')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-amount">{t('common.amount')}</Label>
              <Input
                id="transfer-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                autoFocus
                disabled={!enoughAccounts}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-date">{t('common.date')}</Label>
              <DateField
                id="transfer-date"
                value={date}
                onChange={setDate}
                disabled={!enoughAccounts}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-description">{t('common.description')}</Label>
            <Input
              id="transfer-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={`${t('accounts.transfer')}: ${from?.name ?? ''} → ${to?.name ?? ''}`}
              disabled={!enoughAccounts}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !enoughAccounts}>
              {saving ? t('common.saving') : t('accounts.transfer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
