import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Store as StoreIcon } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { fetchReceipts, fetchStore, type ReceiptSummary } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PriceChangeBadge } from './PriceChangeBadge';
import { SourceBadge } from './SourceBadge';
import { StoreSpendingChart } from './StoreSpendingChart';

type StoreSection = 'overview' | 'receipts' | 'items';

interface Props {
  storeId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Opens a receipt's detail (store → receipt → items). */
  onOpenReceipt?: (receiptId: string) => void;
  /** Opens a product's price history (store → item). */
  onOpenProduct?: (productId: string) => void;
}

/** Compact receipt list shared by the store's overview and receipts sections. */
function ReceiptList({
  receipts,
  onOpenReceipt,
}: {
  receipts: ReceiptSummary[];
  onOpenReceipt?: (receiptId: string) => void;
}) {
  const { t, formatMoney, formatDate } = useI18n();

  if (receipts.length === 0) {
    return <p className="text-sm text-dim">{t('receipts.noReceiptsShort')}</p>;
  }

  return (
    <ul className="divide-y divide-border/60 rounded-md border border-border">
      {receipts.map((receipt) => (
        <li key={receipt.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm sm:gap-3">
          <span className="w-20 shrink-0 text-muted-foreground sm:w-24">
            {receipt.receipt_date ? formatDate(receipt.receipt_date) : '—'}
          </span>
          <span className="hidden shrink-0 text-xs text-dim sm:inline">
            {t('receipts.itemsShort', { count: receipt.item_count })}
          </span>
          <span className="shrink-0"><SourceBadge source={receipt.source} /></span>
          <span className="min-w-0 flex-1 text-right font-medium tabular-nums">
            {receipt.total_amount ? formatMoney(receipt.total_amount) : '—'}
          </span>
          {onOpenReceipt && (
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:w-9 max-sm:px-0"
              onClick={() => onOpenReceipt(receipt.id)}
              aria-label={t('receipts.viewReceipt')}
            >
              <Eye className="h-4 w-4 sm:hidden" />
              <span className="max-sm:hidden">{t('receipts.viewReceipt')}</span>
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Spend, purchases, receipts, and prices for one store. */
export function StoreDetailDialog({
  storeId,
  onOpenChange,
  onOpenReceipt,
  onOpenProduct,
}: Props) {
  const { t, formatMoney } = useI18n();
  const [section, setSection] = React.useState<StoreSection>('overview');
  const [selectedMonth, setSelectedMonth] = React.useState<string | null>(null);

  const storeQuery = useQuery({
    queryKey: ['store', storeId],
    queryFn: () => fetchStore(storeId ?? ''),
    enabled: Boolean(storeId),
  });

  // The detail payload carries only the ten latest receipts, so the full list
  // is fetched when the user asks for that section.
  const receiptsQuery = useQuery({
    queryKey: ['receipts', { storeId, all: true, month: selectedMonth }],
    queryFn: () => {
      if (!selectedMonth) return fetchReceipts({ store_id: storeId ?? '', page_size: 100 });
      const start = `${selectedMonth.slice(0, 7)}-01`;
      const date = new Date(`${start}T00:00:00`);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).toISOString().slice(0, 10);
      return fetchReceipts({ store_id: storeId ?? '', from: start, to: end, page_size: 100 });
    },
    enabled: Boolean(storeId) && section === 'receipts',
  });

  const store = storeQuery.data?.store;

  const sections: Array<{ key: StoreSection; label: string }> = [
    { key: 'overview', label: t('receipts.sectionOverview') },
    { key: 'receipts', label: t('receipts.sectionReceipts') },
    { key: 'items', label: t('receipts.sectionItems') },
  ];

  return (
    <Dialog open={Boolean(storeId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <StoreIcon className="h-4 w-4 text-primary" aria-hidden="true" />
            {store?.name ?? t('receipts.storeFallback')}
          </DialogTitle>
          <DialogDescription>
            {store
              ? t('receipts.storeSummaryLine', {
                  count: store.receipt_count,
                  items: store.item_count,
                  total: formatMoney(store.total_spent),
                })
              : ''}
          </DialogDescription>
        </DialogHeader>

        {storeQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-[200px] w-full rounded-md" />
          </div>
        ) : storeQuery.isError ? (
          <p className="py-4 text-sm text-destructive" role="alert">
            {t('receipts.failedStore')}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex w-full gap-1 overflow-x-auto rounded-md bg-muted p-1" role="tablist">
              {sections.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={section === item.key}
                  onClick={() => setSection(item.key)}
                  className={cn(
                    'shrink-0 flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                    section === item.key
                      ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {section === 'overview' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">{t('receipts.spendingOverTime')}</h3>
                  <StoreSpendingChart
                    months={storeQuery.data?.monthly_spend ?? []}
                    loading={false}
                    onSelectMonth={(month) => {
                      setSelectedMonth(month);
                      setSection('receipts');
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">{t('receipts.mostPurchased')}</h3>
                  {(storeQuery.data?.top_items ?? []).length === 0 ? (
                    <p className="text-sm text-dim">{t('receipts.noItemsRecorded')}</p>
                  ) : (
                    <ul className="divide-y divide-border/60 rounded-md border border-border">
                      {(storeQuery.data?.top_items ?? []).map((item) => (
                        <li
                          key={`${item.description}-${item.product_id ?? 'none'}`}
                          className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm"
                        >
                          {item.product_id && onOpenProduct ? (
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left font-medium text-primary hover:underline"
                              onClick={() => onOpenProduct(item.product_id ?? '')}
                            >
                              {item.description}
                            </button>
                          ) : (
                            <span className="min-w-0 flex-1 truncate">{item.description}</span>
                          )}
                          <span className="shrink-0 text-xs text-dim">
                            {t('receipts.purchasesCount', { count: item.purchase_count })}
                          </span>
                          <span className="w-20 shrink-0 text-right tabular-nums sm:w-24">
                            {formatMoney(item.total)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">{t('receipts.recentReceipts')}</h3>
                  <ReceiptList
                    receipts={storeQuery.data?.recent_receipts ?? []}
                    onOpenReceipt={onOpenReceipt}
                  />
                </div>
              </div>
            )}

            {section === 'receipts' && (
              <div className="space-y-2">
                {receiptsQuery.isLoading ? (
                  <Skeleton className="h-32 w-full rounded-md" />
                ) : (
                  <ReceiptList
                    receipts={receiptsQuery.data?.items ?? []}
                    onOpenReceipt={onOpenReceipt}
                  />
                )}
              </div>
            )}

            {section === 'items' && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">{t('receipts.storeItemsTitle')}</h3>
                {(storeQuery.data?.items ?? []).length === 0 ? (
                  <p className="text-sm text-dim">{t('receipts.noItemsRecorded')}</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-md border border-border">
                    {(storeQuery.data?.items ?? []).map((item) => (
                      <li
                        key={`${item.description}-${item.normalized_product_id ?? 'none'}`}
                        className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm"
                      >
                        {item.normalized_product_id && onOpenProduct ? (
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left font-medium text-primary hover:underline"
                            onClick={() => onOpenProduct(item.normalized_product_id ?? '')}
                          >
                            {item.description}
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">{item.description}</span>
                        )}
                        <PriceChangeBadge value={item.change_percentage} />
                        <span className="w-20 shrink-0 text-right font-semibold tabular-nums sm:w-24">
                          {item.latest_price ? formatMoney(item.latest_price) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

