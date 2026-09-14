import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  ChevronRight,
  FileText,
  Package,
  QrCode,
  Receipt as ReceiptIcon,
  Search,
  Store as StoreIcon,
} from 'lucide-react';

import { useI18n } from '@/app/i18n';
import {
  fetchProduct,
  fetchProducts,
  fetchReceiptStats,
  fetchReceipts,
  fetchStores,
  type StorePeriod,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { PriceChangeBadge } from './PriceChangeBadge';
import { PriceHistoryChart } from './PriceHistoryChart';
import { ScanReceiptCard } from './ScanReceiptCard';
import { SourceBadge } from './SourceBadge';
import { PERIOD_LABEL_KEY, STORE_PERIODS } from './receipt-helpers';
import type { ReceiptScanner } from './useReceiptScanner';

interface Props {
  scanner: ReceiptScanner;
  /** Reveals the scan tab (where the review panel lives). */
  onOpenScan: () => void;
  /** Starts a specific capture method and lands on the scan tab. */
  onStartScan?: (method: 'qr' | 'photo') => void;
  onOpenReceipts: () => void;
  onOpenItems: () => void;
  onOpenStores: () => void;
  onOpenReceipt: (receiptId: string) => void;
  onOpenProduct: (productId: string) => void;
  onOpenStore: (storeId: string) => void;
}

/** One summary card (label, big value, caption). */
function SummaryCard({
  icon,
  label,
  value,
  caption,
  loading,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: string;
  loading: boolean;
  tone: string;
}) {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', tone)}
          >
            {icon}
          </span>
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        </div>
        {loading ? (
          <>
            <Skeleton className="mt-4 h-7 w-24" />
            <Skeleton className="mt-3 h-3 w-28" />
          </>
        ) : (
          <>
            <p className="mt-4 truncate text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">
              {value}
            </p>
            <p className="mt-2.5 truncate text-xs text-dim">{caption}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * Overview: the headline numbers, the scanner, price tracking, the latest
 * receipts and where the money was spent. Everything here is an aggregate the
 * backend computes; no screen lists raw receipts just to count them.
 */
export function OverviewTab({
  scanner,
  onOpenScan,
  onStartScan,
  onOpenReceipts,
  onOpenItems,
  onOpenStores,
  onOpenReceipt,
  onOpenProduct,
  onOpenStore,
}: Props) {
  const { t, formatMoney, formatDate, monthNames } = useI18n();
  const [trackingMode, setTrackingMode] = React.useState<'item' | 'store'>('item');
  const [itemSearch, setItemSearch] = React.useState('');
  const [selectedProduct, setSelectedProduct] = React.useState<string | null>(null);
  const [storePeriod, setStorePeriod] = React.useState<StorePeriod>('month');

  const statsQuery = useQuery({
    queryKey: ['receipts', 'stats'],
    queryFn: () => fetchReceiptStats(),
  });
  const recentQuery = useQuery({
    queryKey: ['receipts', 'recent'],
    queryFn: () => fetchReceipts({ page_size: 5 }),
  });
  const topStoresQuery = useQuery({
    queryKey: ['stores', { period: storePeriod, sort: 'spend', page_size: 5 }],
    queryFn: () => fetchStores({ period: storePeriod, sort: 'spend', page_size: 5 }),
  });
  const productSearchQuery = useQuery({
    queryKey: ['products', { search: itemSearch, page_size: 5 }],
    queryFn: () => fetchProducts({ search: itemSearch.trim() || undefined, page_size: 5 }),
    enabled: trackingMode === 'item' && itemSearch.trim().length >= 2,
  });
  const productDetailQuery = useQuery({
    queryKey: ['product', selectedProduct],
    queryFn: () => fetchProduct(selectedProduct ?? ''),
    enabled: Boolean(selectedProduct),
  });

  const stats = statsQuery.data;
  const recent = recentQuery.data?.items ?? [];
  const topStores = topStoresQuery.data?.items ?? [];
  const productMatches = productSearchQuery.data?.items ?? [];
  const tracked = productDetailQuery.data;

  const now = new Date();
  const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  const statsLoading = statsQuery.isLoading;
  const empty = !statsLoading && (stats?.total_receipts ?? 0) === 0;

  return (
    <div className="space-y-4">
      {/* Headline numbers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={<ReceiptIcon className="h-5 w-5" />}
          tone="bg-success/15 text-success"
          label={t('receipts.summaryReceipts')}
          value={String(stats?.total_receipts ?? 0)}
          caption={
            (stats?.receipts_this_month ?? 0) > 0
              ? t('receipts.summaryThisMonth', { count: stats?.receipts_this_month ?? 0 })
              : t('receipts.summaryAllTime')
          }
          loading={statsLoading}
        />
        <SummaryCard
          icon={<FileText className="h-5 w-5" />}
          tone="bg-info/15 text-info"
          label={t('receipts.summarySpent')}
          value={formatMoney(stats?.total_spent ?? '0')}
          caption={monthLabel}
          loading={statsLoading}
        />
        <SummaryCard
          icon={<Package className="h-5 w-5" />}
          tone="bg-purple/15 text-purple"
          label={t('receipts.summaryItems')}
          value={String(stats?.items_tracked ?? 0)}
          caption={t('receipts.summaryItemsCaption', { count: stats?.price_records ?? 0 })}
          loading={statsLoading}
        />
        <SummaryCard
          icon={<StoreIcon className="h-5 w-5" />}
          tone="bg-primary/15 text-primary"
          label={t('receipts.summaryStores')}
          value={String(stats?.store_count ?? 0)}
          caption={t('receipts.summaryAllTime')}
          loading={statsLoading}
        />
      </div>

      {/* Phones: the two capture paths as large touch targets */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        <button
          type="button"
          onClick={onStartScan ? () => onStartScan('qr') : onOpenScan}
          className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-4 py-4 transition-colors active:bg-surface-hover"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
            <QrCode className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium">{t('receipts.quickScanQr')}</span>
        </button>
        <button
          type="button"
          onClick={onStartScan ? () => onStartScan('photo') : onOpenScan}
          className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-4 py-4 transition-colors active:bg-surface-hover"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-info/15 text-info">
            <Camera className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium">{t('receipts.quickUploadPhoto')}</span>
        </button>
      </div>

      {empty ? (
        <Card className="border-border bg-surface p-7 shadow-card">
          <EmptyState
            icon={<Camera className="h-8 w-8" />}
            title={t('receipts.firstReceiptTitle')}
            description={t('receipts.firstReceiptDesc')}
            action={<Button onClick={onOpenScan}>{t('receipts.scanCta')}</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          {/* Main column: scanner + latest receipts */}
          <div className="flex flex-col gap-4">
            <ScanReceiptCard scanner={scanner} onParsed={onOpenScan} />

            <Card className="border-border bg-surface shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
                <div>
                  <h2 className="text-lg font-semibold">{t('receipts.recentReceipts')}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t('receipts.recentReceiptsBlurb')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenReceipts}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t('receipts.viewAll')}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="px-5 pb-5">
                {recentQuery.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-14 w-full rounded-[12px]" />
                    <Skeleton className="h-14 w-full rounded-[12px]" />
                  </div>
                ) : recent.length === 0 ? (
                  <p className="py-6 text-center text-sm text-dim">{t('receipts.noReceiptsShort')}</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {recent.map((receipt) => (
                      <li key={receipt.id} className="flex items-center gap-3 py-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
                          <StoreIcon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {receipt.store_name ?? t('receipts.unknownStore')}
                          </span>
                          <span className="block text-xs text-dim">
                            {receipt.receipt_date ? formatDate(receipt.receipt_date) : '—'} ·{' '}
                            {t('receipts.itemsShort', { count: receipt.item_count })}
                          </span>
                        </span>
                        <SourceBadge source={receipt.source} />
                        <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
                          {receipt.total_amount ? formatMoney(receipt.total_amount) : '—'}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => onOpenReceipt(receipt.id)}>
                          {t('receipts.viewReceipt')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          {/* Sidebar: price tracking, top stores, shortcuts */}
          <div className="flex flex-col gap-4">
            <Card className="border-border bg-surface shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
                <div>
                  <h2 className="text-lg font-semibold">{t('receipts.priceTracking')}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t('receipts.priceTrackingBlurb')}
                  </p>
                </div>
              </div>
              <div className="space-y-3 px-5 pb-5">
                <div className="flex gap-1 rounded-md bg-muted p-1" role="tablist">
                  {(
                    [
                      { key: 'item', label: t('receipts.trackByItem') },
                      { key: 'store', label: t('receipts.trackByStore') },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      role="tab"
                      aria-selected={trackingMode === option.key}
                      onClick={() => setTrackingMode(option.key)}
                      className={cn(
                        'flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
                        trackingMode === option.key
                          ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {trackingMode === 'item' ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={itemSearch}
                        onChange={(event) => {
                          setItemSearch(event.target.value);
                          setSelectedProduct(null);
                        }}
                        placeholder={t('receipts.searchAnItem')}
                        aria-label={t('receipts.searchAnItem')}
                      />
                    </div>

                    {itemSearch.trim().length < 2 ? (
                      <p className="text-xs text-dim">{t('receipts.searchAnItemHint')}</p>
                    ) : productSearchQuery.isLoading ? (
                      <Skeleton className="h-16 w-full rounded-md" />
                    ) : productMatches.length === 0 ? (
                      <p className="text-xs text-dim">{t('receipts.noMatchingItems')}</p>
                    ) : (
                      <ul className="divide-y divide-border/60 rounded-md border border-border">
                        {productMatches.map((product) => (
                          <li key={product.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedProduct(product.id)}
                              className={cn(
                                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/[0.045]',
                                selectedProduct === product.id && 'bg-primary/[0.06]',
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">{product.name}</span>
                              <span className="shrink-0 font-medium tabular-nums">
                                {product.latest_price ? formatMoney(product.latest_price) : '—'}
                              </span>
                              <PriceChangeBadge value={product.change_percentage} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {topStoresQuery.isLoading ? (
                      <Skeleton className="h-20 w-full rounded-md" />
                    ) : topStores.length === 0 ? (
                      <p className="text-xs text-dim">{t('receipts.noStoresShort')}</p>
                    ) : (
                      <ul className="divide-y divide-border/60 rounded-md border border-border">
                        {topStores.map((store) => (
                          <li key={store.id}>
                            <button
                              type="button"
                              onClick={() => onOpenStore(store.id)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/[0.045]"
                            >
                              <span className="min-w-0 flex-1 truncate">{store.name}</span>
                              <span className="shrink-0 text-xs text-dim">
                                {t('receipts.itemsShort', { count: store.item_count })}
                              </span>
                              <span className="shrink-0 font-medium tabular-nums">
                                {formatMoney(store.total_spent)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </Card>

                {/* Selected item: average, trend and its recorded prices */}
                {trackingMode === 'item' && selectedProduct && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    {productDetailQuery.isLoading ? (
                      <Skeleton className="h-[200px] w-full rounded-md" />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">
                            {tracked?.product.name}
                          </span>
                          <PriceChangeBadge value={tracked?.product.change_percentage} />
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-bold tabular-nums">
                            {tracked?.product.average_price
                              ? formatMoney(tracked.product.average_price)
                              : '—'}
                          </span>
                          <span className="text-xs text-dim">{t('receipts.currentAverage')}</span>
                        </div>
                        {(tracked?.records.length ?? 0) > 1 ? (
                          <PriceHistoryChart records={tracked?.records ?? []} loading={false} />
                        ) : (
                          <p className="text-xs text-dim">{t('receipts.notEnoughHistory')}</p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => onOpenProduct(selectedProduct)}
                        >
                          {t('receipts.openFullHistory')}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                )}

            {/* Top stores by spending, with the period filter */}
            <Card className="border-border bg-surface shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
                <h2 className="text-lg font-semibold">{t('receipts.topStores')}</h2>
                <select
                  className="h-8 rounded-md border border-input bg-surface px-2 text-xs shadow-sm dark:[color-scheme:dark]"
                  value={storePeriod}
                  onChange={(event) => setStorePeriod(event.target.value as StorePeriod)}
                  aria-label={t('receipts.periodLabel')}
                >
                  {STORE_PERIODS.map((option) => (
                    <option key={option} value={option}>
                      {t(PERIOD_LABEL_KEY[option] as 'receipts.periodAll')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="px-5 pb-5">
                {topStoresQuery.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : topStores.length === 0 ? (
                  <p className="text-xs text-dim">{t('receipts.noStoresShort')}</p>
                ) : (
                  <ul className="space-y-2.5">
                    {topStores.map((store, index) => {
                      const top = Number.parseFloat(topStores[0]?.total_spent ?? '0') || 1;
                      const share = Math.round(
                        ((Number.parseFloat(store.total_spent) || 0) / top) * 100,
                      );
                      return (
                        <li key={store.id} className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="w-4 shrink-0 text-xs text-dim">{index + 1}</span>
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left hover:text-primary"
                              onClick={() => onOpenStore(store.id)}
                            >
                              {store.name}
                            </button>
                            <span className="shrink-0 tabular-nums">
                              {formatMoney(store.total_spent)}
                            </span>
                          </div>
                          <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(share, 100)}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={onOpenStores}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t('receipts.viewAllStores')}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </Card>

            {/* Quick actions */}
            <Card className="border-border bg-surface shadow-card">
              <div className="p-5 pb-3">
                <h2 className="text-lg font-semibold">{t('dashboard.quickActions')}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                {(
                  [
                    {
                      key: 'scan',
                      icon: Camera,
                      label: t('receipts.quickScan'),
                      onClick: onOpenScan,
                      tone: 'bg-success/15 text-success ring-success/30 hover:bg-success/25',
                    },
                    {
                      key: 'receipts',
                      icon: ReceiptIcon,
                      label: t('receipts.quickReceipts'),
                      onClick: onOpenReceipts,
                      tone: 'bg-primary/15 text-primary ring-primary/30 hover:bg-primary/25',
                    },
                    {
                      key: 'items',
                      icon: Package,
                      label: t('receipts.quickItems'),
                      onClick: onOpenItems,
                      tone: 'bg-purple/15 text-purple ring-purple/30 hover:bg-purple/25',
                    },
                    {
                      key: 'stores',
                      icon: StoreIcon,
                      label: t('receipts.quickStores'),
                      onClick: onOpenStores,
                      tone: 'bg-info/15 text-info ring-info/30 hover:bg-info/25',
                    },
                  ] as const
                ).map((tile) => (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={tile.onClick}
                    className={cn(
                      'flex min-h-[72px] flex-col justify-center gap-2 rounded-md px-3.5 py-3 text-left text-sm font-medium ring-1 ring-inset transition-colors',
                      tile.tone,
                    )}
                  >
                    <tile.icon className="h-4 w-4" />
                    <span className="leading-tight">{tile.label}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
