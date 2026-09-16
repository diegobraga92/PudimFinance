import * as React from 'react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { DateField } from '@/components/DateField';
import { toIsoDate } from '@/lib/date-input';
import { createCardPurchase, type AccountWithBalance, type Category, type CreateCardPurchaseRequest } from '@/lib/api';
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
  categories: Category[];
  onSaved: () => void;
}

/** Dialog for recording a purchase directly on a credit-card account. */
export function CardPurchaseDialog({ open, onOpenChange, card, categories, onSaved }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [description, setDescription] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [date, setDate] = React.useState(() => toIsoDate(new Date()));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const expenseCategories = React.useMemo(() => categories.filter((item) => item.type === 'expense'), [categories]);

  React.useEffect(() => {
    if (!open) return;
    setDescription('');
    setAmount('');
    setCategory('');
    setDate(toIsoDate(new Date()));
    setError(null);
  }, [open]);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (!description.trim()) {
      setError(t('creditCards.validation.desc'));
      return;
    }
    if (!(amountNum > 0)) {
      setError(t('creditCards.validation.amount'));
      return;
    }
    if (!card) return;

    setSaving(true);
    setError(null);
    const payload: CreateCardPurchaseRequest = {
      description: description.trim(),
      amount: amount.replace(',', '.'),
      category_id: category || null,
      date,
    };
    try {
      await createCardPurchase(card.id, payload);
      onOpenChange(false);
      onSaved();
      toast({ title: t('creditCards.recorded'), variant: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('creditCards.failedRecord'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('creditCards.purchaseModalTitle')}</DialogTitle>
          <DialogDescription>{card?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cc-desc">{t('common.description')}</Label>
            <Input
              id="cc-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('creditCards.descPlaceholder')}
              autoFocus
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cc-amount">{t('common.amount')}</Label>
              <Input
                id="cc-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-date">{t('common.date')}</Label>
              <DateField id="cc-date" value={date} onChange={setDate} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-category">{t('common.category')}</Label>
            <select
              id="cc-category"
              className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">— {t('common.none')} —</option>
              {expenseCategories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? t('common.saving') : t('creditCards.record')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}