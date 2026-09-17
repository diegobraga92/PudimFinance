import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { fetchProduct } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PriceChangeBadge } from './PriceChangeBadge';
import { PriceHistoryChart } from './PriceHistoryChart';

type PriceRange = '3m' | '6m' | '1y' | 'all';

/** Days of history per range; `null` means "everything on record". */
const RANGE_DAYS: Record<PriceRange, number | null> = {
  '3m': 90,
  '6m': 180,
  '1y': 365,
  all: null,
};

interface Props {
  productId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Opens a store's detail (the two-way item ↔ store navigation). */
  onOpenStore?: (storeId: string) => void;
}

/** One headline number (average, lowest, …). */
function Stat({
  label,
  value,
  badge,
  tone,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-hover/40 px-3 py-2.5">
      <p className="text-xs text-dim">{label}</p>
      <p className={cn('mt-1 text-base font-semibold tabular-nums', tone)}>{value}</p>
      {badge && <div className="mt-1">{badge}</div>}
    </div>
  );
}

/**
 * Price history of one normalized product: statistics, a chart of the prices
 * actually paid, the individual purchases and where it is cheapest.
 */
export function ProductDetailDialog({ productId, onOpenChange, onOpenStore }: Props) {
  const { t, formatMoney, formatDate } = useI18n();
  const [range, setRange] = React.useState<PriceRange>('6m');

  const query = useQuery({
    queryKey: ['product', productId],
    queryFn: () => fetchProduct(productId ?? ''),
    enabled: Boolean(productId),
  });

  const product = query.data?.product;
  const records = React.useMemo(() => query.data?.records ?? [], [query.data]);
  const byStore = React.useMemo(() => query.data?.by_store ?? [], [query.data]);

  // Range filtering is presentation only: the API returns every record.
  const ranged = React.useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days === null) return records;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const iso = cutoff.toISOString().slice(0, 10);
    return records.filter((record) => (record.date ?? '') >= iso);
  }, [records, range]);

  const enoughHistory = records.length > 1;

  // "Cheaper than average" compares the cheapest latest price with the mean of
  // the latest prices per store — both read from the API's own numbers.
  const latestPrices = byStore
    .map((store) => Number.parseFloat(store.latest_price ?? '0'))
    .filter((value) => value > 0);
  const latestAverage =
    latestPrices.length > 0
      ? latestPrices.reduce((sum, value) => sum + value, 0) / latestPrices.length
      : 0;
  const cheapest = byStore[0];
  const saving =
    cheapest && latestAverage > 0
      ? latestAverage - Number.parseFloat(cheapest.latest_price ?? '0')
      : 0;

  return (
    <Dialog open={Boolean(productId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{product?.name ?? t('receipts.productFallback')}</DialogTitle>
          <DialogDescription>{t('receipts.productPriceBlurb')}</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-[200px] w-full rounded-md" />
          </div>
        ) : query.isError ? (
          <div className="space-y-2 py-4" role="alert">
            <p className="text-sm text-destructive">{t('receipts.failedPriceHistory')}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={t('receipts.currentAverage')}
                value={product?.average_price ? formatMoney(product.average_price) : '—'}
              />
              <Stat
                label={t('receipts.latestPrice')}
                value={product?.latest_price ? formatMoney(product.latest_price) : '—'}
                badge={<PriceChangeBadge value={product?.change_percentage} />}
              />
              <Stat
                label={t('receipts.lowestPrice')}
                value={product?.lowest_price ? formatMoney(product.lowest_price) : '—'}
                tone="text-success"
              />
              <Stat
                label={t('receipts.highestPrice')}
                value={product?.highest_price ? formatMoney(product.highest_price) : '—'}
                tone="text-danger"
              />
            </div>

            <p className="text-xs text-dim">
              {t('receipts.priceRecordsSummary', {
                count: product?.record_count ?? 0,
                stores: product?.store_count ?? 0,
                date: product?.last_seen ? formatDate(product.last_seen) : '—',
              })}
            </p>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t('receipts.priceHistoryTitle')}</h3>
                <div className="flex gap-1 rounded-md bg-muted p-1">
                  {(['3m', '6m', '1y', 'all'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRange(key)}
                      aria-pressed={range === key}
                      className={cn(
                        'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                        range === key
                          ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t(
                        key === '3m'
                          ? 'receipts.range3m'
                          : key === '6m'
                            ? 'receipts.range6m'
                            : key === '1y'
                              ? 'receipts.range1y'
                              : 'receipts.rangeAll',
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {enoughHistory ? (
                <PriceHistoryChart
                  records={ranged}
                  loading={false}
                  onSelectRecord={(record) => {
                    if (record.store_id && onOpenStore) onOpenStore(record.store_id);
                  }}
                />
              ) : (
                <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm font-medium">{t('receipts.notEnoughHistory')}</p>
                  <p className="mt-1 text-xs text-dim">{t('receipts.notEnoughHistoryHint')}</p>
                  {product?.latest_price && (
                    <p className="mt-2 text-lg font-semibold tabular-nums">
                      {formatMoney(product.latest_price)}
                    </p>
                  )}
                </div>
              )}
            </div>
            {/* Recent purchases: the actual recorded prices (not averages). */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('receipts.recentPurchases')}</h3>
              {ranged.length === 0 ? (
                <p className="text-sm text-dim">{t('receipts.noPriceRecords')}</p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-md border border-border">
                  {ranged.slice(0, 12).map((record) => (
                    <li
                      key={`${record.receipt_id}-${record.description}`}
                      className="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <span className="w-24 shrink-0 text-muted-foreground">
                        {record.date ? formatDate(record.date) : '—'}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {record.store_name ?? t('receipts.unknownStore')}
                      </span>
                      <span className="shrink-0 text-xs text-dim">
                        {t('receipts.quantityShort', { count: String(record.quantity) })}
                      </span>
                      <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                        {record.price ? formatMoney(record.price) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {ranged.length > 12 && (
                <p className="text-xs text-dim">
                  {t('receipts.showingPurchases', { shown: 12, total: ranged.length })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('receipts.cheaperTitle')}</h3>
              {byStore.length === 0 ? (
                <p className="text-sm text-dim">{t('receipts.noPriceRecords')}</p>
              ) : (
                <>
                  <ul className="divide-y divide-border/60 rounded-md border border-border">
                    {byStore.map((store) => (
                      <li
                        key={store.store_id ?? store.store_name ?? 'unknown'}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                      >
                        {store.store_id && onOpenStore ? (
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left font-medium text-primary hover:underline"
                            onClick={() => onOpenStore(store.store_id ?? '')}
                          >
                            {store.store_name ?? t('receipts.unknownStore')}
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            {store.store_name ?? t('receipts.unknownStore')}
                          </span>
                        )}
                        <PriceChangeBadge value={store.change_percentage} />
                        <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                          {store.latest_price ? formatMoney(store.latest_price) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {saving > 0 && cheapest && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                      <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('receipts.cheaperNote', {
                        store: cheapest.store_name ?? t('receipts.unknownStore'),
                        amount: formatMoney(saving),
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}