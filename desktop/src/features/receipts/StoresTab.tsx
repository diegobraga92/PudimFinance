import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, Store as StoreIcon } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { fetchStores, type StorePeriod } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { ReceiptDetailDialog } from './ReceiptDetailDialog';
import { ProductDetailDialog } from './ProductDetailDialog';
import { PeriodSelect } from './PeriodSelect';
import { StoreDetailDialog } from './StoreDetailDialog';

const PAGE_SIZE = 12;
const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-surface px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark] max-md:h-11 max-md:px-3';

/** Stores tab: receipt and spending history by store. */
export function StoresTab() {
  const { t, formatMoney, formatDate } = useI18n();

  const [search, setSearch] = React.useState('');
  const [period, setPeriod] = React.useState<StorePeriod>('all');
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [storeId, setStoreId] = React.useState<string | null>(null);
  const [receiptId, setReceiptId] = React.useState<string | null>(null);
  const [productId, setProductId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPage(0);
  }, [search, period]);

  const storesQuery = useQuery({
    queryKey: ['stores', { search, period, page }],
    queryFn: () =>
      fetchStores({
        search: search.trim() || undefined,
        period,
        sort: 'spend',
        page,
        page_size: PAGE_SIZE,
      }),
  });

  const rows = storesQuery.data?.items ?? [];
  const totalCount = storesQuery.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const filtersActive = Boolean(search.trim()) || period !== 'all';

  const clearAll = () => {
    setSearch('');
    setPeriod('all');
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('receipts.storesTitle')}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('receipts.storesBlurb')}</p>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div className="flex items-center gap-2 md:contents">
          <div className="relative min-w-0 flex-1 sm:w-64 md:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('receipts.searchStores')}
              aria-label={t('receipts.searchStores')}
            />
          </div>
          <Button
            variant={mobileFiltersOpen ? 'default' : 'outline'}
            size="icon"
            className="md:hidden"
            onClick={() => setMobileFiltersOpen((open) => !open)}
            aria-expanded={mobileFiltersOpen}
            aria-label={t('transactions.filters.title')}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        <div
          className={cn(
            'flex flex-wrap items-center gap-2 md:contents',
            !mobileFiltersOpen && 'max-md:hidden',
          )}
        >
          <PeriodSelect
            value={period}
            onChange={setPeriod}
            className={`${SELECT_CLASS} max-md:w-full md:w-auto`}
          />
          {filtersActive && (
            <Button variant="ghost" size="sm" className="max-md:w-full" onClick={clearAll}>
              {t('receipts.clearFilters')}
            </Button>
          )}
        </div>
      </div>

      {storesQuery.isLoading ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((row) => (
            <Card key={row} className="space-y-3 p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-32" />
            </Card>
          ))}
        </div>
      ) : storesQuery.isError ? (
        <Card className="p-7">
          <EmptyState
            icon={<StoreIcon className="h-8 w-8" />}
            title={t('receipts.failedStores')}
            description={t('receipts.connectionHint')}
            action={
              <Button variant="outline" onClick={() => void storesQuery.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-7">
          <EmptyState
            icon={<StoreIcon className="h-8 w-8" />}
            title={filtersActive ? t('receipts.noMatches') : t('receipts.noStoresTitle')}
            description={filtersActive ? t('receipts.noMatchesDesc') : t('receipts.noStoresDesc')}
          />
        </Card>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((store) => (
            <Card key={store.id} className="min-w-0 border-border bg-surface p-5 shadow-card">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
                  <StoreIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{store.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('receipts.storeCardLine', {
                      receipts: store.receipt_count,
                      items: store.item_count,
                    })}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t('receipts.storeLastVisit', {
                      date: store.last_visit ? formatDate(store.last_visit) : '—',
                    })}
                  </p>
                </div>
                <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:shrink-0 sm:justify-end sm:text-right">
                  <p className="text-base font-semibold tabular-nums">
                    {formatMoney(store.total_spent)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-0 sm:mt-2"
                    onClick={() => setStoreId(store.id)}
                  >
                    {t('receipts.viewStore')}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalCount > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-dim">
            {t('receipts.pageInfo', { page: page + 1, pages: pageCount, count: totalCount })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('receipts.previousPage')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              {t('receipts.nextPage')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <StoreDetailDialog
        storeId={storeId}
        onOpenChange={(open) => !open && setStoreId(null)}
        onOpenReceipt={(id) => {
          setStoreId(null);
          setReceiptId(id);
        }}
        onOpenProduct={(id) => {
          setStoreId(null);
          setProductId(id);
        }}
      />
      <ReceiptDetailDialog
        receiptId={receiptId}
        onOpenChange={(open) => !open && setReceiptId(null)}
        onOpenProduct={(id) => {
          setReceiptId(null);
          setProductId(id);
        }}
      />
      <ProductDetailDialog
        productId={productId}
        onOpenChange={(open) => !open && setProductId(null)}
        onOpenStore={(id) => {
          setProductId(null);
          setStoreId(id);
        }}
      />
    </div>
  );
}

