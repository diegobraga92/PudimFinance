import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Trash2, X } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  deleteReceiptItem,
  fetchReceipt,
  updateReceiptItem,
  type ReceiptItemDetail,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SourceBadge } from './SourceBadge';

interface Props {
  receiptId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Opens the price history of an item's normalized product. */
  onOpenProduct?: (productId: string) => void;
}

/** Product · qty · unit · total · actions. */
const ITEM_GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_5.5rem_4.5rem] items-center gap-2';

/**
 * Receipt detail with inline item editing.
 *
 * Every mutation goes through the API, which recomputes the receipt total, so
 * the dialog always shows the backend's numbers rather than a local guess.
 */
export function ReceiptDetailDialog({ receiptId, onOpenChange, onOpenProduct }: Props) {
  const { t, formatMoney, formatDate, formatDateTime } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ description: '', quantity: '', unit_price: '' });

  const detailQuery = useQuery({
    queryKey: ['receipt', receiptId],
    queryFn: () => fetchReceipt(receiptId ?? ''),
    enabled: Boolean(receiptId),
  });

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['receipt', receiptId] });
    await queryClient.invalidateQueries({ queryKey: ['receipts'] });
    await queryClient.invalidateQueries({ queryKey: ['products'] });
    await queryClient.invalidateQueries({ queryKey: ['stores'] });
  }, [queryClient, receiptId]);

  const saveItem = useMutation({
    mutationFn: (item: ReceiptItemDetail) =>
      updateReceiptItem(receiptId ?? '', item.id, {
        description: form.description.trim(),
        quantity: form.quantity || undefined,
        unit_price: form.unit_price || undefined,
      }),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
      toast({ title: t('receipts.itemUpdated') });
    },
    onError: (err: unknown) =>
      toast({
        title: err instanceof Error ? err.message : t('receipts.failedItemUpdate'),
        variant: 'error',
      }),
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => deleteReceiptItem(receiptId ?? '', itemId),
    onSuccess: async () => {
      await refresh();
      toast({ title: t('receipts.itemDeleted') });
    },
    onError: (err: unknown) =>
      toast({
        title: err instanceof Error ? err.message : t('receipts.failedItemDelete'),
        variant: 'error',
      }),
  });

  const startEdit = (item: ReceiptItemDetail) => {
    setEditing(item.id);
    setForm({
      description: item.description,
      quantity: String(item.quantity),
      unit_price: item.unit_price ?? '',
    });
  };

  const receipt = detailQuery.data?.receipt;
  const items = detailQuery.data?.items ?? [];
  const busy = saveItem.isPending || removeItem.isPending;

  return (
    <Dialog open={Boolean(receiptId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {receipt?.store_name ?? t('receipts.unknownStore')}
            <SourceBadge source={receipt?.source} />
          </DialogTitle>
          <DialogDescription>
            {receipt?.receipt_date ? formatDate(receipt.receipt_date) : '—'}
            {receipt ? ` · ${formatDateTime(receipt.scanned_at)}` : ''}
            {receipt?.total_amount
              ? ` · ${t('receipts.total')}: ${formatMoney(receipt.total_amount)}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : detailQuery.isError ? (
          <div className="space-y-2 py-4" role="alert">
            <p className="text-sm text-destructive">{t('receipts.failedReceipt')}</p>
            <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('receipts.itemsCount', { count: receipt?.item_count ?? 0 })}
            </p>

            <div
              className={cn(
                ITEM_GRID,
                'px-1 text-[11px] font-semibold uppercase tracking-wide text-dim',
              )}
            >
              <span>{t('receipts.product')}</span>
              <span className="text-right">{t('receipts.quantity')}</span>
              <span className="text-right">{t('receipts.unitPrice')}</span>
              <span className="text-right">{t('receipts.total')}</span>
              <span />
            </div>

            <ul className="divide-y divide-border/60 rounded-md border border-border">
              {items.map((item) => (
                <ReceiptItemRow
                  key={item.id}
                  item={item}
                  editing={editing === item.id}
                  form={form}
                  busy={busy}
                  onFormChange={setForm}
                  onStartEdit={() => startEdit(item)}
                  onCancelEdit={() => setEditing(null)}
                  onSave={() => saveItem.mutate(item)}
                  onDelete={() => removeItem.mutate(item.id)}
                  onOpenProduct={onOpenProduct}
                />
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


/** One line of the receipt: display mode, or an inline editor. */
function ReceiptItemRow({
  item,
  editing,
  form,
  busy,
  onFormChange,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onOpenProduct,
}: {
  item: ReceiptItemDetail;
  editing: boolean;
  form: { description: string; quantity: string; unit_price: string };
  busy: boolean;
  onFormChange: (form: { description: string; quantity: string; unit_price: string }) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
  onOpenProduct?: (productId: string) => void;
}) {
  const { t, formatMoney } = useI18n();

  if (editing) {
    return (
      <li className={cn(ITEM_GRID, 'p-2')}>
        <Input
          value={form.description}
          onChange={(event) => onFormChange({ ...form, description: event.target.value })}
          aria-label={t('receipts.product')}
        />
        <Input
          value={form.quantity}
          inputMode="decimal"
          onChange={(event) => onFormChange({ ...form, quantity: event.target.value })}
          aria-label={t('receipts.quantity')}
        />
        <Input
          value={form.unit_price}
          inputMode="decimal"
          onChange={(event) => onFormChange({ ...form, unit_price: event.target.value })}
          aria-label={t('receipts.unitPrice')}
        />
        <span className="text-right text-xs text-dim">{t('receipts.itemTotalHint')}</span>
        <span className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-success"
            disabled={busy || !form.description.trim()}
            onClick={onSave}
            aria-label={t('common.save')}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onCancelEdit}
            aria-label={t('common.cancel')}
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      </li>
    );
  }

  return (
    <li className={cn(ITEM_GRID, 'px-2 py-2.5 text-sm')}>
      <span className="min-w-0">
        {item.normalized_product_id && onOpenProduct ? (
          <button
            type="button"
            className="block max-w-full truncate text-left font-medium text-primary hover:underline"
            onClick={() => onOpenProduct(item.normalized_product_id ?? '')}
          >
            {item.product_name ?? item.description}
          </button>
        ) : (
          <span className="block truncate">{item.description}</span>
        )}
        {item.product_name && item.product_name !== item.description && (
          <span className="block truncate text-xs text-dim">{item.description}</span>
        )}
      </span>
      <span className="text-right tabular-nums">{String(item.quantity)}</span>
      <span className="text-right tabular-nums">
        {item.unit_price ? formatMoney(item.unit_price) : '—'}
      </span>
      <span className="text-right font-medium tabular-nums">
        {item.total_price ? formatMoney(item.total_price) : '—'}
      </span>
      <span className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onStartEdit}
          aria-label={t('receipts.editItem')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={onDelete}
          aria-label={t('receipts.deleteItem')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </span>
    </li>
  );
}

