import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Merge, Package, Search } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  fetchProducts,
  mergeProducts,
  type ProductListQuery,
  type ProductSummary,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PriceChangeBadge } from './PriceChangeBadge';
import { ProductDetailDialog } from './ProductDetailDialog';

const PAGE_SIZE = 25;
type ChangeFilter = NonNullable<ProductListQuery['change']>;
const ROW_GRID =
  'lg:grid lg:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_5rem_5rem] lg:items-center lg:gap-3';
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-surface px-3 text-sm shadow-sm dark:[color-scheme:dark] max-md:h-11';

/** Items & Prices: the price-tracking browser. */
export function ItemsPricesTab() {
  const { t, formatMoney } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = React.useState('');
  const [change, setChange] = React.useState<ChangeFilter>('all');
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [mergeTarget, setMergeTarget] = React.useState('');
  const [mergeSource, setMergeSource] = React.useState('');

  React.useEffect(() => {
    setPage(0);
  }, [search, change]);

  const productsQuery = useQuery({
    queryKey: ['products', { search, change, page }],
    queryFn: () =>
      fetchProducts({
        search: search.trim() || undefined,
        change,
        sort: 'name',
        page,
        page_size: PAGE_SIZE,
      }),
  });

  // Merge candidates: one page of products, unfiltered, loaded on demand.
  const mergeCandidates = useQuery({
    queryKey: ['products', 'merge-options'],
    queryFn: () => fetchProducts({ page_size: 200, sort: 'name' }),
    enabled: mergeOpen,
  });

  const merge = useMutation({
    mutationFn: () => mergeProducts({ target_id: mergeTarget, source_id: mergeSource }),
    onSuccess: async () => {
      setMergeOpen(false);
      setMergeTarget('');
      setMergeSource('');
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['product'] });
      toast({ title: t('receipts.merged'), variant: 'success' });
    },
    onError: (err: unknown) =>
      toast({
        title: err instanceof Error ? err.message : t('receipts.failedMerge'),
        variant: 'error',
      }),
  });

  const rows = productsQuery.data?.items ?? [];
  const totalCount = productsQuery.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const filtersActive = Boolean(search.trim()) || change !== 'all';

  const filters: Array<{ key: ChangeFilter; label: string }> = [
    { key: 'all', label: t('receipts.filterAll') },
    { key: 'recent', label: t('receipts.filterRecent') },
    { key: 'increased', label: t('receipts.filterIncreased') },
    { key: 'decreased', label: t('receipts.filterDecreased') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('receipts.itemsPageTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('receipts.itemsBlurb')}</p>
        </div>
        <Button variant="outline" className="w-full gap-1.5 sm:w-auto" onClick={() => setMergeOpen(true)}>
          <Merge className="h-4 w-4" />
          {t('receipts.mergeTitle')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-[12rem] sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('receipts.searchProducts')}
            aria-label={t('receipts.searchProducts')}
          />
        </div>
        <div className="flex w-full shrink-0 gap-1 overflow-x-auto rounded-md bg-muted p-1 md:w-fit" role="tablist">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              role="tab"
              aria-selected={change === filter.key}
              onClick={() => setChange(filter.key)}
              className={cn(
                'shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
                change === filter.key
                  ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {productsQuery.isLoading ? (
        <Card className="space-y-3 p-5">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </Card>
      ) : productsQuery.isError ? (
        <Card className="p-7">
          <EmptyState
            icon={<Package className="h-8 w-8" />}
            title={t('receipts.failedProducts')}
            description={t('receipts.connectionHint')}
            action={
              <Button variant="outline" onClick={() => void productsQuery.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-7">
          <EmptyState
            icon={<Package className="h-8 w-8" />}
            title={filtersActive ? t('receipts.noMatches') : t('receipts.noItemsTitle')}
            description={filtersActive ? t('receipts.noMatchesDesc') : t('receipts.noItemsDesc')}
          />
        </Card>
      ) : (
        <Card className="min-w-0 overflow-hidden border-border bg-surface shadow-card">
          <div
            className={cn(
              'hidden border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim',
              ROW_GRID,
            )}
          >
            <span>{t('receipts.product')}</span>
            <span className="text-right">{t('receipts.latestPrice')}</span>
            <span className="text-right">{t('receipts.previousPrice')}</span>
            <span className="text-right">{t('receipts.changeLabel')}</span>
            <span className="text-right">{t('receipts.recordsLabel')}</span>
            <span className="text-right">{t('receipts.storesLabel')}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {rows.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                formatMoney={formatMoney}
                onOpen={() => setSelected(product.id)}
              />
            ))}
          </ul>
        </Card>
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

      <ProductDetailDialog
        productId={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />

      {/* Merge duplicates: the backend owns normalization, this only repairs it. */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('receipts.mergeTitle')}</DialogTitle>
            <DialogDescription>{t('receipts.mergeBlurb')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="merge-target">{t('receipts.mergeTarget')}</Label>
              <select
                id="merge-target"
                className={SELECT_CLASS}
                value={mergeTarget}
                onChange={(event) => setMergeTarget(event.target.value)}
              >
                <option value="">—</option>
                {(mergeCandidates.data?.items ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="merge-source">{t('receipts.mergeSource')}</Label>
              <select
                id="merge-source"
                className={SELECT_CLASS}
                value={mergeSource}
                onChange={(event) => setMergeSource(event.target.value)}
              >
                <option value="">—</option>
                {(mergeCandidates.data?.items ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            {mergeSource && mergeSource === mergeTarget && (
              <p className="text-xs text-destructive">{t('receipts.pickTwo')}</p>
            )}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => setMergeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={
                !mergeTarget || !mergeSource || mergeTarget === mergeSource || merge.isPending
              }
              onClick={() => merge.mutate()}
            >
              {t('receipts.merge')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


/** One product row: name, latest, previous, change, records, stores. */
function ProductRow({
  product,
  formatMoney,
  onOpen,
}: {
  product: ProductSummary;
  formatMoney: (value: string | number) => string;
  onOpen: () => void;
}) {
  const { t, formatDate } = useI18n();

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'grid w-full min-w-0 grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-primary/[0.045]',
          ROW_GRID,
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{product.name}</span>
          {product.last_seen && (
            <span className="block text-xs text-dim">
              {t('receipts.lastSeen', { date: formatDate(product.last_seen) })}
            </span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2 text-sm font-semibold tabular-nums lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('receipts.latestPrice')}</span>
          <span>{product.latest_price ? formatMoney(product.latest_price) : '—'}</span>
        </span>
        <span className="flex items-center justify-between gap-2 text-sm tabular-nums text-muted-foreground lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('receipts.previousPrice')}</span>
          <span>{product.previous_price ? formatMoney(product.previous_price) : '—'}</span>
        </span>
        <span className="flex items-center justify-between gap-2 lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('receipts.changeLabel')}</span>
          <span>
            <PriceChangeBadge
              value={product.change_percentage}
              fallback={t('receipts.singleRecord')}
            />
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 text-sm tabular-nums text-muted-foreground lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('receipts.recordsLabel')}</span>
          <span>{product.record_count}</span>
        </span>
        <span className="flex items-center justify-between gap-2 text-sm tabular-nums text-muted-foreground lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('receipts.storesLabel')}</span>
          <span>{product.store_count}</span>
        </span>
      </button>
    </li>
  );
}

