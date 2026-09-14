import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/app/i18n';
import {
  createAccount,
  updateAccount,
  type AccountWithBalance,
  type CreateAccountRequest,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/** User-facing account kinds (backend `account_kind`). */
export type AccountKind = 'bank' | 'cash' | 'card' | 'loan' | 'investment';

export const ACCOUNT_TYPE_FOR_KIND: Record<AccountKind, string> = {
  bank: 'asset',
  cash: 'asset',
  investment: 'asset',
  card: 'liability',
  loan: 'liability',
};

export const KIND_OPTIONS: {
  key: AccountKind;
  labelKey:
    | 'accounts.kind.bank'
    | 'accounts.kind.cash'
    | 'accounts.kind.card'
    | 'accounts.kind.loan'
    | 'accounts.kind.investment';
  icon: string;
}[] = [
  { key: 'bank', labelKey: 'accounts.kind.bank', icon: '🏦' },
  { key: 'cash', labelKey: 'accounts.kind.cash', icon: '💵' },
  { key: 'card', labelKey: 'accounts.kind.card', icon: '💳' },
  { key: 'loan', labelKey: 'accounts.kind.loan', icon: '🏛️' },
  { key: 'investment', labelKey: 'accounts.kind.investment', icon: '📈' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AccountWithBalance | null;
  initialKind: AccountKind;
  onSaved: (name: string) => void;
}

export function AccountForm({ open, onOpenChange, editing, initialKind, onSaved }: Props) {
  const { t } = useI18n();
  const isEditing = editing !== null;

  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<AccountKind>(initialKind);
  const [closingDay, setClosingDay] = React.useState('');
  const [dueDay, setDueDay] = React.useState('');
  const [creditLimit, setCreditLimit] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setKind((editing?.account_kind as AccountKind | null) ?? initialKind);
    setClosingDay(editing?.closing_day ? String(editing.closing_day) : '');
    setDueDay(editing?.due_day ? String(editing.due_day) : '');
    setCreditLimit(editing?.credit_limit ?? '');
    setError(null);
    setSaving(false);
  }, [open, editing, initialKind]);

  const isCard = kind === 'card';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('accounts.validation.name'));
      return;
    }

    let payload: CreateAccountRequest = {
      name: trimmed,
      type: ACCOUNT_TYPE_FOR_KIND[kind],
      account_kind: kind,
    };

    if (isCard) {
      const closing = dayValue(closingDay);
      const due = dayValue(dueDay);
      if (!closing || !due) {
        setError(t('accounts.validation.cardDays'));
        return;
      }
      if (closing < 1 || closing > 31) {
        setError(t('accounts.validation.closingDay'));
        return;
      }
      if (due < 1 || due > 31) {
        setError(t('accounts.validation.dueDay'));
        return;
      }
      payload = {
        ...payload,
        closing_day: closing,
        due_day: due,
        credit_limit: creditLimit.trim() ? creditLimit.trim() : null,
      };
    }

    setSaving(true);
    setError(null);
    try {
      if (isEditing && editing) {
        await updateAccount(editing.id, payload);
      } else {
        await createAccount(payload);
      }
      onSaved(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('accounts.failedSave'));
    } finally {
      setSaving(false);
    }
  };


function dayValue(value: string): number | null {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('accounts.form.edit') : t('accounts.form.new')}</DialogTitle>
          <DialogDescription>
            {t('accounts.form.name')} · {t('accounts.form.type')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="acc-name">{t('accounts.form.name')}</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('accounts.form.namePlaceholder')}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('accounts.form.type')}</Label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setKind(opt.key)}
                  className={cn(
                    'flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 text-center text-xs font-medium leading-tight transition-colors',
                    kind === opt.key
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover',
                  )}
                >
                  <span className="text-base">{opt.icon}</span>
                  <span className="text-balance">{t(opt.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {isCard && (
            <>
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {t('accounts.form.cardHint')}
              </p>
              <div className="grid items-end gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="acc-closing">{t('accounts.form.closingDay')}</Label>
                  <Input
                    id="acc-closing"
                    type="number"
                    min={1}
                    max={31}
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-due">{t('accounts.form.dueDay')}</Label>
                  <Input
                    id="acc-due"
                    type="number"
                    min={1}
                    max={31}
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-limit">{t('accounts.form.creditLimit')}</Label>
                  <Input
                    id="acc-limit"
                    inputMode="decimal"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? t('common.saving')
                : isEditing
                  ? t('accounts.form.saveChanges')
                  : t('accounts.form.createAccount')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

