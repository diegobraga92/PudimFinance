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
import { adjustAccount, type AccountWithBalance } from '@/lib/api';
import { toIsoDate } from '@/lib/date-input';
import { isOnline } from '@/offline/net';

interface Props {
  open: boolean;
  account: AccountWithBalance | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/** Online-only reconciliation flow backed by the equity adjustment account. */
export function AdjustBalanceDialog({ open, account, onOpenChange, onSaved }: Props) {
  const { t } = useI18n();
  const [target, setTarget] = React.useState('');
  const [date, setDate] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !account) return;
    setTarget(Math.abs(Number.parseFloat(account.balance) || 0).toFixed(2));
    setDate(toIsoDate(new Date()));
    setDescription('');
    setError(null);
    setSaving(false);
  }, [open, account]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!account) return;
    const normalized = target.trim().replace(',', '.');
    const amount = Number.parseFloat(normalized);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(t('accounts.validation.initialBalance'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!(await isOnline())) {
        setError(t('accounts.adjust.offline'));
        return;
      }
      await adjustAccount(account.id, {
        target_balance: normalized,
        date,
        description: description.trim() || null,
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('accounts.adjust.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('accounts.adjust.title', { name: account?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('accounts.adjust.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="adjust-target">{t('accounts.adjust.target')}</Label>
              <Input id="adjust-target" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-date">{t('accounts.adjust.date')}</Label>
              <DateField id="adjust-date" value={date} onChange={setDate} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-description">{t('accounts.adjust.notes')}</Label>
            <Input id="adjust-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('accounts.adjust.notesPlaceholder')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('accounts.adjust')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}