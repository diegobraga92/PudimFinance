import * as React from 'react';
import { DateField } from '@/components/DateField';
import { toIsoDate } from '@/lib/date-input';
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
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/app/i18n';
import {
  createTransaction,
  updateTransaction,
  type AccountWithBalance,
  type Category,
  type CreateTransactionRequest,
  type Transaction,
} from '@/lib/api';
import { categoryIcon } from '@shared/category-icons';
import { findPreviousTransaction } from '@/offline/autocomplete';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  accounts: AccountWithBalance[];
  /** Transaction being edited, or null to create a new one. */
  editing: Transaction | null;
  /** Only meaningful when creating (the Quick Add flows preselect a type). */
  initialType?: 'income' | 'expense';
  onSaved: () => void;
}

/** Segmented income/expense toggle. */
function TypeToggle({
  value,
  onChange,
}: {
  value: 'income' | 'expense';
  onChange: (v: 'income' | 'expense') => void;
}) {
  const { t } = useI18n();
  const options: { key: 'income' | 'expense'; label: string }[] = [
    { key: 'expense', label: t('common.expense') },
    { key: 'income', label: t('common.income') },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="tab"
          aria-selected={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === opt.key
              ? opt.key === 'income'
                ? 'bg-income text-white shadow-sm'
                : 'bg-expense text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function TransactionForm({
  open,
  onOpenChange,
  categories,
  accounts,
  editing,
  initialType = 'expense',
  onSaved,
}: Props) {
  const { t } = useI18n();
  const isEditing = editing !== null;

  const [description, setDescription] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [type, setType] = React.useState<'income' | 'expense'>(initialType);
  const [categoryId, setCategoryId] = React.useState('');
  const [date, setDate] = React.useState(() => toIsoDate(new Date()));
  const [notes, setNotes] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [installments, setInstallments] = React.useState('1');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [filledHint, setFilledHint] = React.useState<string | null>(null);

  // Reset the form whenever the dialog opens (create) or target changes (edit).
  React.useEffect(() => {
    if (!open) return;
    setDescription(editing?.description ?? '');
    setAmount(editing?.amount ?? '');
    setType(editing?.type === 'income' ? 'income' : initialType);
    setCategoryId(editing?.category_id ?? '');
    setDate(editing?.date ?? toIsoDate(new Date()));
    setNotes(editing?.notes ?? '');
    setAccountId(editing?.account_id ?? '');
    setInstallments('1');
    setError(null);
    setSaving(false);
    setFilledHint(null);
  }, [open, editing, initialType]);

  // Description-based autocomplete. Prefill amount, type, and category from the
  // last matching transaction in the local mirror (offline-friendly).
  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    if (isEditing) return;
    void (async () => {
      const prev = await findPreviousTransaction(value);
      if (!prev) {
        setFilledHint(null);
        return;
      }
      setAmount(prev.amount);
      setType(prev.type);
      setCategoryId(prev.category_id ?? '');
      const cat = categories.find((c) => c.id === prev.category_id);
      setFilledHint(
        t('transactions.form.filledPrevious', {
          amount: `R$ ${parseFloat(prev.amount).toFixed(2)}`,
          category: cat?.name ?? t('transactions.form.noCategory'),
        }),
      );
    })();
  };

  const filteredCategories = categories.filter((c) => c.type === type);
  const paymentAccounts = accounts.filter(
    (a) => a.account_kind === 'bank' || a.account_kind === 'cash' || a.account_kind === 'card',
  );

  const installmentsNum = parseInt(installments, 10);
  const amountNum = parseFloat(amount.replace(',', '.'));
  const showInstallments = installmentsNum > 1 && amountNum > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError(t('common.nameRequired'));
      return;
    }
    if (!(amountNum > 0)) {
      setError(t('quickAdd.amountError'));
      return;
    }
    setSaving(true);
    setError(null);
    const payload: CreateTransactionRequest = {
      description: description.trim(),
      amount: amount.replace(',', '.'),
      type,
      category_id: categoryId || null,
      date,
      notes: notes.trim() || null,
      account_id: accountId || null,
      installments: installmentsNum > 1 ? installmentsNum : undefined,
    };
    try {
      if (isEditing && editing) {
        await updateTransaction(editing.id, payload);
      } else {
        await createTransaction(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('transactions.form.failedSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('transactions.form.edit') : t('transactions.form.add')}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t('common.edit') : t('common.expense') + ' / ' + t('common.income')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}


          <div className="space-y-1.5">
            <Label htmlFor="tx-description">{t('common.description')}</Label>
            <Input
              id="tx-description"
              value={description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              placeholder={t('transactions.form.descriptionPlaceholder')}
              autoFocus
            />
            {filledHint && <p className="text-xs text-income">{filledHint}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-amount">{t('common.amount')}</Label>
              <Input
                id="tx-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t('transactions.form.amountPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('common.type')}</Label>
              <TypeToggle value={type} onChange={setType} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-category">{t('common.category')}</Label>
              <select
                id="tx-category"
                className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">— {t('common.none')} —</option>
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${categoryIcon(c.icon)} ` : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-date">{t('common.date')}</Label>
              <DateField id="tx-date" value={date} onChange={setDate} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-account">{t('transactions.form.account')}</Label>
              <select
                id="tx-account"
                className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">— {t('transactions.form.defaultAccount')} —</option>
                {paymentAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.type === 'liability' ? ' 💳' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-installments">{t('transactions.form.installments')}</Label>
              <Input
                id="tx-installments"
                type="number"
                min={1}
                max={60}
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              />
              {showInstallments && (
                <p className="text-xs text-dim">
                  {t('transactions.form.perInstallment', {
                    installments: String(installmentsNum),
                    amount: `R$ ${(amountNum / installmentsNum).toFixed(2)}`,
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-notes">{t('common.notes')}</Label>
            <Textarea
              id="tx-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('transactions.form.notesPlaceholder')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? t('common.saving')
                : isEditing
                  ? t('transactions.form.saveChanges')
                  : t('transactions.form.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

