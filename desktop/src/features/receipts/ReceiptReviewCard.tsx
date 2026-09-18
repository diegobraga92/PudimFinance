import { Plus, ReceiptText, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SourceBadge } from './SourceBadge';
import type { EditableReceiptItem, ReceiptScanner } from './useReceiptScanner';

interface Props {
  scanner: ReceiptScanner;
  /** Called after the receipt is stored. */
  onSaved?: () => void;
}

const ITEM_GRID = 'grid grid-cols-[minmax(0,1fr)_5rem_6.5rem_6.5rem_2.25rem] gap-2';

/** Review step for parsed receipt data before saving. */
export function ReceiptReviewCard({ scanner, onSaved }: Props) {
  const { t, formatMoney } = useI18n();
  const draft = scanner.draft;
  if (!draft) return null;

  const itemCount = draft.items.filter((item) => item.description.trim()).length;

  const updateItem = (index: number, field: keyof EditableReceiptItem, value: string) =>
    scanner.updateItem(index, field, value);

  return (
    <Card className="border-primary/40 bg-surface shadow-card">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-lg font-semibold">{t('receipts.reviewTitle')}</h2>
          </div>
          <SourceBadge source={draft.source} />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="review-store">{t('receipts.store')}</Label>
            <Input
              id="review-store"
              value={draft.store_name}
              onChange={(event) => scanner.updateDraft({ store_name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-date">{t('receipts.date')}</Label>
            <Input
              id="review-date"
              type="date"
              value={draft.date.slice(0, 10)}
              onChange={(event) => scanner.updateDraft({ date: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-total">{t('receipts.total')}</Label>
            <Input
              id="review-total"
              inputMode="decimal"
              value={draft.total}
              onChange={(event) => scanner.updateDraft({ total: event.target.value })}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {t('receipts.reviewSummary', { count: itemCount, total: formatMoney(draft.total || '0') })}
        </p>

        {draft.detailsUnavailable && (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {t('receipts.detailsUnavailable')}
          </p>
        )}

        <div className="space-y-2">
          <div className={`${ITEM_GRID} px-1 text-[11px] font-semibold uppercase tracking-wide text-dim`}>
            <span>{t('receipts.item')}</span>
            <span className="text-right">{t('receipts.quantity')}</span>
            <span className="text-right">{t('receipts.unitPrice')}</span>
            <span className="text-right">{t('receipts.total')}</span>
            <span />
          </div>

          <ul className="space-y-2">
            {draft.items.map((item, index) => (
              <li key={index} className={ITEM_GRID}>
                <Input
                  value={item.description}
                  onChange={(event) => updateItem(index, 'description', event.target.value)}
                  aria-label={t('receipts.item')}
                />
                <Input
                  value={item.quantity}
                  inputMode="decimal"
                  onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                  aria-label={t('receipts.quantity')}
                />
                <Input
                  value={item.unit_price}
                  inputMode="decimal"
                  onChange={(event) => updateItem(index, 'unit_price', event.target.value)}
                  aria-label={t('receipts.unitPrice')}
                />
                <Input
                  value={item.total_price}
                  inputMode="decimal"
                  onChange={(event) => updateItem(index, 'total_price', event.target.value)}
                  aria-label={t('receipts.total')}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => scanner.removeItem(index)}
                  aria-label={t('receipts.removeItem')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>

          <Button variant="ghost" size="sm" className="gap-1.5" onClick={scanner.addItem}>
            <Plus className="h-4 w-4" />
            {t('receipts.addItem')}
          </Button>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={scanner.reset}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void scanner.save().then((ok) => ok && onSaved?.())}>
            {t('receipts.saveReceipt')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
