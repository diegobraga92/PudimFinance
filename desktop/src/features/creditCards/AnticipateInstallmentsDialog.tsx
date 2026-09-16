import * as React from 'react';
import { CheckSquare } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  anticipateInstallments,
  fetchInstallmentPlan,
  fetchInstallmentPlans,
  type CardBill,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toIsoDate } from '@/lib/date-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface AnticipatableItem {
  installmentId: string;
  planDescription: string;
  number: number;
  total: number;
  amount: string;
  dueDate: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string | null;
  currentBill: CardBill | null;
  onSaved: () => void;
}

/** Dialog for moving selected future installments into the current card bill. */
export function AnticipateInstallmentsDialog({
  open,
  onOpenChange,
  cardId,
  currentBill,
  onSaved,
}: Props) {
  const { t, formatMoney, formatDate } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = React.useState<AnticipatableItem[]>([]);
  const [checked, setChecked] = React.useState<string[]>([]);
  const [discountPercent, setDiscountPercent] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !cardId) return;
    let active = true;
    setItems([]);
    setChecked([]);
    setDiscountPercent('');
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const plans = (await fetchInstallmentPlans()).filter((plan) => plan.account_id === cardId);
        const cutoff = currentBill?.due_date ?? toIsoDate(new Date());
        const nextItems: AnticipatableItem[] = [];
        for (const plan of plans) {
          const detail = await fetchInstallmentPlan(plan.id);
          for (const installment of detail.installments) {
            if (installment.status === 'paid' || installment.anticipated_at) continue;
            if (installment.due_date <= cutoff) continue;
            nextItems.push({
              installmentId: installment.id,
              planDescription: plan.description,
              number: installment.installment_number,
              total: plan.installments,
              amount: plan.installment_amount,
              dueDate: installment.due_date,
            });
          }
        }
        if (active) setItems(nextItems);
      } catch {
        if (active) setError(t('creditCards.failedLoadInstallments'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [cardId, currentBill?.due_date, open, t]);

  const toggle = (id: string) => {
    setChecked((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  };

  const handleSubmit = async () => {
    if (!cardId) return;
    if (checked.length === 0) {
      setError(t('creditCards.validation.installment'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await anticipateInstallments(cardId, {
        installment_ids: checked,
        discount_percent: discountPercent.trim() ? discountPercent.trim() : null,
      });
      onOpenChange(false);
      onSaved();
      toast({
        title: t('creditCards.anticipated', {
          count: result.installments_anticipated,
          amount: formatMoney(result.discount_amount),
        }),
        variant: 'success',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('creditCards.failedAnticipate'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('creditCards.anticipateTitle')}</DialogTitle>
          <DialogDescription>{t('creditCards.anticipateDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {loading ? (
            <p className="py-6 text-center text-sm text-dim">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-dim">{t('creditCards.noFutureInstallments')}</p>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {items.map((item) => {
                const selected = checked.includes(item.installmentId);
                return (
                  <button
                    key={item.installmentId}
                    type="button"
                    onClick={() => toggle(item.installmentId)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'border-primary bg-accent'
                        : 'border-border bg-surface hover:bg-surface-hover',
                    )}
                  >
                    <CheckSquare className={cn('h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-dim')} />
                    <span className="min-w-0 flex-1 truncate">
                      {t('creditCards.installmentItem', {
                        number: item.number,
                        total: item.total,
                        description: item.planDescription,
                      })}
                    </span>
                    <span className="shrink-0 text-xs text-dim">{formatDate(item.dueDate)}</span>
                    <span className="shrink-0 font-medium tabular-nums">{formatMoney(item.amount)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="discount-pct">{t('creditCards.discountLabel')}</Label>
            <Input
              id="discount-pct"
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(event) => setDiscountPercent(event.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || loading || items.length === 0}>
            {saving ? t('common.saving') : t('creditCards.anticipateShort')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}