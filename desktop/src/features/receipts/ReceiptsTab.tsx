import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Receipt as ReceiptIcon,
  Search,
  Trash2,
} from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { deleteReceipt, fetchReceipts, fetchStores, type ReceiptSummary } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';
import { ReceiptDetailDialog } from './ReceiptDetailDialog';
import { SourceBadge } from './SourceBadge';

const PAGE_SIZE = 20;
const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-surface px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]';

/** Receipt list row grid (labels are shown inline on narrow screens). */
const ROW_GRID =
  'lg:grid lg:grid-cols-[7rem_minmax(0,1fr)_5rem_7rem_6rem_5rem] lg:items-center lg:gap-3';

interface Props {
  /** Opens a product's price history (from an item in the detail dialog). */
  onOpenProduct: (productId: string) => void;
}

/** Full receipt history with filters, paging and the detail/edit dialog. */
export function ReceiptsTab({ onOpenProduct }: Props) {
  const { t, formatMoney, formatDate } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = React.useState('');
  const [storeId, setStoreId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [minTotal, setMinTotal] = React.useState('');
  const [maxTotal, setMaxTotal] = React.useState('');
  const [source, setSource] = React.useState<'' | 'nfce' | 'ocr'>('');
  const [page, setPage] = React.useState(0);
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ReceiptSummary | null>(null);

  // Any filter change restarts the listing from the first page.
  React.useEffect(() => {
    setPage(0);
  }, [search, storeId, from, to, minTotal, maxTotal, source]);

  const storesQuery = useQuery({
    queryKey: ['stores', 'picker'],
    queryFn: () => fetchStores({ page_size: 200 }),
  });

  const receiptsQuery = useQuery({
    queryKey: ['receipts', { search, storeId, from, to, minTotal, maxTotal, source, page }],
    queryFn: () =>
      fetchReceipts({
        search: search.trim() || undefined,
        store_id: storeId || undefined,
        from: from || undefined,
        to: to || undefined,
        min_total: minTotal || undefined,
        max_total: maxTotal || undefined,
        source: source || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteReceipt(id),
    onSuccess: async () => {
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['stores'] });
      toast({ title: t('receipts.deleted') });
    },
    onError: (err: unknown) => {
      setPendingDelete(null);
      toast({
        title: err instanceof Error ? err.message : t('receipts.failedDelete'),
        variant: 'error',
      });
    },
  });

  const rows = receiptsQuery.data?.items ?? [];
  const totalCount = receiptsQuery.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const filtersActive = Boolean(search || storeId || from || to || minTotal || maxTotal || source);


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-[12rem] sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('receipts.searchPlaceholder')}
            aria-label={t('receipts.searchPlaceholder')}
          />
        </div>
        <select
          className={SELECT_CLASS}
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          aria-label={t('receipts.filterStore')}
        >
          <option value="">{t('receipts.allStores')}</option>
          {(storesQuery.data?.items ?? []).map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={source}
          onChange={(event) => setSource(event.target.value as '' | 'nfce' | 'ocr')}
          aria-label={t('receipts.filterSource')}
        >
          <option value="">{t('receipts.allSources')}</option>
          <option value="nfce">{t('receipts.sourceNfce')}</option>
          <option value="ocr">{t('receipts.sourceOcr')}</option>
        </select>
        <Input
          type="date"
          className="w-[9.5rem]"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          aria-label={t('receipts.filterFrom')}
        />
        <Input
          type="date"
          className="w-[9.5rem]"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          aria-label={t('receipts.filterTo')}
        />
        <Input
          className="w-[7rem]"
          inputMode="decimal"
          value={minTotal}
          onChange={(event) => setMinTotal(event.target.value)}
          placeholder={t('receipts.filterMin')}
          aria-label={t('receipts.filterMin')}
        />
        <Input
          className="w-[7rem]"
          inputMode="decimal"
          value={maxTotal}
          onChange={(event) => setMaxTotal(event.target.value)}
          placeholder={t('receipts.filterMax')}
          aria-label={t('receipts.filterMax')}
        />
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setStoreId('');
              setFrom('');
              setTo('');
              setMinTotal('');
              setMaxTotal('');
              setSource('');
            }}
          >
            {t('receipts.clearFilters')}
          </Button>
        )}
      </div>

      {receiptsQuery.isLoading ? (
        <Card className="space-y-3 p-5">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </Card>
      ) : receiptsQuery.isError ? (
        <Card className="p-7">
          <EmptyState
            icon={<ReceiptIcon className="h-8 w-8" />}
            title={t('receipts.failedList')}
            description={t('receipts.connectionHint')}
            action={
              <Button variant="outline" onClick={() => void receiptsQuery.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-7">
          <EmptyState
            icon={<ReceiptIcon className="h-8 w-8" />}
            title={filtersActive ? t('receipts.noMatches') : t('receipts.noReceiptsTitle')}
            description={filtersActive ? t('receipts.noMatchesDesc') : t('receipts.noReceiptsDesc')}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden border-border bg-surface shadow-card">
          <div
            className={cn(
              'hidden border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim',
              ROW_GRID,
            )}
          >
            <span>{t('receipts.tableDate')}</span>
            <span>{t('receipts.tableStore')}</span>
            <span className="text-right">{t('receipts.tableItems')}</span>
            <span className="text-right">{t('receipts.tableTotal')}</span>
            <span>{t('receipts.tableSource')}</span>
            <span />
          </div>
          <ul className="divide-y divide-border/60">
            {rows.map((receipt) => (
              <li
                key={receipt.id}
                className={cn(
                  'grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-primary/[0.045]',
                  ROW_GRID,
                )}
              >
                <span className="text-sm text-muted-foreground">
                  {receipt.receipt_date ? formatDate(receipt.receipt_date) : '—'}
                </span>
                <span className="min-w-0 truncate text-sm font-medium">
                  {receipt.store_name ?? t('receipts.unknownStore')}
                </span>
                <span className="text-sm tabular-nums lg:text-right">
                  {t('receipts.itemsShort', { count: receipt.item_count })}
                </span>
                <span className="text-sm font-semibold tabular-nums lg:text-right">
                  {receipt.total_amount ? formatMoney(receipt.total_amount) : '—'}
                </span>
                <span>
                  <SourceBadge source={receipt.source} />
                </span>
                <span className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => setViewing(receipt.id)}
                    aria-label={t('receipts.viewReceipt')}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(receipt)}
                    aria-label={t('receipts.deleteReceipt')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
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

      <ReceiptDetailDialog
        receiptId={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onOpenProduct={(productId) => {
          setViewing(null);
          onOpenProduct(productId);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('receipts.deleteTitle')}
        description={
          pendingDelete
            ? t('receipts.deleteMessage', {
                store: pendingDelete.store_name ?? t('receipts.unknownStore'),
                date: pendingDelete.receipt_date ? formatDate(pendingDelete.receipt_date) : '—',
              })
            : ''
        }
        busy={remove.isPending}
        destructive
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
