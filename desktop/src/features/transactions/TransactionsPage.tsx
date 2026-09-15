import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Filter, Pencil, Plus, ReceiptText, Search, SearchX, SlidersHorizontal, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  createTransaction,
  deleteTransaction,
  fetchAccountsWithBalance,
  fetchCategories,
  fetchTransactions,
  type Transaction,
  type TransactionFilters,
} from '@/lib/api';
import { DateRangeField } from '@/components/DateRangeField';
import { toIsoDate } from '@/lib/date-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AccountIcon } from '@/components/AccountIcon';
import { CategoryIcon } from '@/components/CategoryIcon';
import { TransactionForm } from './TransactionForm';
import { TransactionListRow } from './TransactionListRow';
import { TransactionsSidebar } from './TransactionsSidebar';
import { groupTransactionsByMonth } from './group-by-month';
import type { TranslationKey } from '@shared/i18n';
import { refreshWidgetSpentToday } from '@/lib/widget';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

/** Type chips shown above the phone list. */
const TYPE_CHIPS: { key: 'all' | 'income' | 'expense'; labelKey: TranslationKey }[] = [
  { key: 'all', labelKey: 'transactions.filters.allTypes' },
  { key: 'income', labelKey: 'transactions.filters.income' },
  { key: 'expense', labelKey: 'transactions.filters.expense' },
];

export function TransactionsPage() {
  const { t, formatMoney, formatDate, monthNames } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Quick Add navigates to /transactions?add=1. Open the form once, then clear.
  const [formOpen, setFormOpen] = React.useState(false);
  const [formType, setFormType] = React.useState<'income' | 'expense'>('expense');
  const [editing, setEditing] = React.useState<Transaction | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Transaction | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [filterType, setFilterType] = React.useState<'all' | 'income' | 'expense'>('all');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [filterCategory, setFilterCategory] = React.useState('');
  const [sort, setSort] = React.useState<TransactionFilters['sort']>('date');
  const [order, setOrder] = React.useState<TransactionFilters['order']>('desc');

  const [items, setItems] = React.useState<Transaction[]>([]);
  const [page, setPage] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Phone-only: reveals the date/category controls behind the filter button. */
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  /** Rows ticked in the table, for bulk deletion. */
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = React.useState(false);

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetchAccountsWithBalance(),
  });
  const categories = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const accounts = React.useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const categoryById = React.useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const load = React.useCallback(
    async (nextPage: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const filters: TransactionFilters = { page: nextPage, page_size: PAGE_SIZE };
        if (filterType !== 'all') filters.type = filterType;
        if (startDate) filters.start_date = startDate;
        if (endDate) filters.end_date = endDate;
        if (filterCategory) filters.category_id = filterCategory;
        filters.sort = sort;
        filters.order = order;
        const res = await fetchTransactions(filters);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setPage(res.page);
        setHasMore(res.page * PAGE_SIZE + res.items.length < res.total);
        // A new search/filter starts a fresh tick selection.
        if (!append) setSelectedIds(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.loadTransactions'));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [t, filterType, startDate, endDate, filterCategory, sort, order],
  );

  React.useEffect(() => {
    void load(0, false);
  }, [load]);

  // Handle the ?add=1 deep link exactly once.
  React.useEffect(() => {
    if (searchParams.get('add') === '1') {
      setEditing(null);
      setFormType(searchParams.get('type') === 'income' ? 'income' : 'expense');
      setFormOpen(true);
      searchParams.delete('add');
      searchParams.delete('type');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Client-side search, since the backend has no `q` filter. Matches legacy behavior.
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((tx) => {
      const cat = tx.category_id ? categoryById.get(tx.category_id) : undefined;
      return (
        tx.description.toLowerCase().includes(q) ||
        tx.notes?.toLowerCase().includes(q) ||
        (cat?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, query, categoryById]);

  const refreshAll = React.useCallback(async () => {
    await load(0, false);
    await queryClient.invalidateQueries({ queryKey: ['summary'] });
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    void refreshWidgetSpentToday();
  }, [load, queryClient]);

  const openCreate = (type: 'income' | 'expense') => {
    setEditing(null);
    setFormType(type);
    setFormOpen(true);
  };

  const openEdit = (tx: Transaction) => {
    setEditing(tx);
    setFormOpen(true);
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(visible.map((tx) => tx.id)) : new Set());
  };

  /** The API deletes one transaction at a time, so send them together. */
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => deleteTransaction(id)));
      // Close first so the dialog's count stays put while it animates out;
      // the reload below resets the tick selection.
      setBulkConfirmOpen(false);
      await refreshAll();
      toast({
        title: t(
          ids.length === 1 ? 'transactions.bulkDeleted_one' : 'transactions.bulkDeleted_other',
          { count: ids.length },
        ),
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('transactions.failedToDelete'),
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const deleted = pendingDelete;
    try {
      await deleteTransaction(deleted.id);
      setPendingDelete(null);
      await refreshAll();
      toast({
        title: t('transactions.deleted', { description: deleted.description }),
        action: {
          label: t('transactions.undo'),
          onClick: () => {
            void (async () => {
              try {
                await createTransaction({
                  description: deleted.description,
                  amount: deleted.amount,
                  type: deleted.type as 'income' | 'expense',
                  category_id: deleted.category_id,
                  date: deleted.date,
                  notes: deleted.notes,
                  account_id: deleted.account_id,
                });
                await refreshAll();
                toast({ title: t('transactions.restored') });
              } catch {
                toast({ title: t('transactions.couldNotRestore'), variant: 'error' });
              }
            })();
          },
        },
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('transactions.failedToDelete'),
        variant: 'error',
      });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const exportCsv = () => {
    if (visible.length === 0) return;
    const rows = [
      ['Date', 'Type', 'Description', 'Category', 'Amount', 'Notes'],
      ...visible.map((tx) => [
        tx.date,
        tx.type,
        `"${tx.description.replace(/"/g, '""')}"`,
        tx.category_id && categoryById.get(tx.category_id)
          ? `"${categoryById.get(tx.category_id)!.name.replace(/"/g, '""')}"`
          : t('common.uncategorised'),
        tx.amount,
        tx.notes ? `"${tx.notes.replace(/"/g, '""')}"` : '',
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${toIsoDate(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: t('transactions.exported', { count: visible.length }), variant: 'success' });
  };

  const hasFilters = filterType !== 'all' || !!startDate || !!endDate || !!filterCategory;
  const clearFilters = () => {
    setFilterType('all');
    setStartDate('');
    setEndDate('');
    setFilterCategory('');
  };
  const clearAll = () => {
    clearFilters();
    setQuery('');
  };

  const sortBy = (field: NonNullable<TransactionFilters['sort']>) => {
    if (sort === field) {
      setOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setOrder(field === 'date' ? 'desc' : 'asc');
    }
  };

  const sortHeader = (
    field: NonNullable<TransactionFilters['sort']>,
    label: string,
  ) => {
    const active = sort === field;
    return (
      <button
        type="button"
        onClick={() => sortBy(field)}
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
        aria-label={`${label}: ${t(order === 'asc' ? 'transactions.sort.ascending' : 'transactions.sort.descending')}`}
      >
        {label}
        {active && (order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    );
  };
  const searching = query.trim().length > 0;

  // Row ticks for bulk deletion; the header box mirrors the rows in view.
  const allSelected = visible.length > 0 && visible.every((tx) => selectedIds.has(tx.id));
  const someSelected = !allSelected && visible.some((tx) => selectedIds.has(tx.id));

  // Phones show the list under month headings ("SEPTEMBER 2026").
  const monthGroups = React.useMemo(
    () => groupTransactionsByMonth(visible, monthNames),
    [visible, monthNames],
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        titleKey="nav.transactions"
        subtitleKey="transactions.subtitle"
        actions={
          <>
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={visible.length === 0}
              aria-label={t('transactions.export')}
            >
              <Download className="h-4 w-4" />
              <span className="max-md:hidden">{t('transactions.export')}</span>
            </Button>
            {/* The FAB covers "new transaction" on phones. */}
            <Button className="max-md:hidden" onClick={() => openCreate('expense')}>
              <Plus className="h-4 w-4" />
              {t('transactions.newTransaction')}
            </Button>
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4 md:gap-6">

          {/* Search + filters: their own box, above the table. */}
          {(items.length > 0 || hasFilters || searching) && (
            <Card className="shadow-card">
              <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-3 md:p-5">
                {/* Search — on phones the only control until the filter toggle. */}
                <div className="flex min-w-0 items-center gap-2 md:max-w-xs md:flex-1">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('transactions.search')}
                      aria-label={t('transactions.searchAria')}
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

                {/* Type + category share the search's row on desktop. */}
                <div
                  className={cn(
                    'flex flex-col gap-2 md:flex-row md:items-center md:gap-2',
                    !mobileFiltersOpen && 'max-md:hidden',
                  )}
                >
                  <select
                    aria-label={t('transactions.filters.allTypes')}
                    className="h-11 w-full rounded-md border border-input bg-surface px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark] md:h-9 md:w-auto"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as 'all' | 'income' | 'expense')}
                  >
                    <option value="all">{t('transactions.filters.allTypes')}</option>
                    <option value="income">{t('transactions.filters.income')}</option>
                    <option value="expense">{t('transactions.filters.expense')}</option>
                  </select>
                  <select
                    aria-label={t('transactions.filters.category')}
                    className="h-11 w-full rounded-md border border-input bg-surface px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark] md:h-9 md:max-w-[12rem] md:w-auto"
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                  >
                    <option value="">{t('transactions.filters.allCategories')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {(hasFilters || searching) && (
                    <Button variant="ghost" size="sm" className="max-md:hidden" onClick={clearAll}>
                      <Filter className="h-4 w-4" />
                      {t('transactions.filters.clear')}
                    </Button>
                  )}
                </div>

                {/* The whole range is one labelled control, last on the right. */}
                <div className={cn('flex md:ml-auto', !mobileFiltersOpen && 'max-md:hidden')}>
                  <DateRangeField
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(range) => {
                      setStartDate(range.startDate);
                      setEndDate(range.endDate);
                    }}
                    className="md:w-[15rem]"
                  />
                </div>
              </div>

              {/* Phones: quick type chips, always available. */}
              <div className="flex items-center gap-2 px-4 pb-4 md:hidden">
                <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-0.5">
                  {TYPE_CHIPS.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => setFilterType(chip.key)}
                      aria-pressed={filterType === chip.key}
                      className={cn(
                        'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                        filterType === chip.key
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-surface text-muted-foreground',
                      )}
                    >
                      {t(chip.labelKey)}
                    </button>
                  ))}
                </div>
                {(hasFilters || searching) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('transactions.filters.clear')}
                    onClick={clearAll}
                  >
                    <Filter className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          )}

          {/* Results */}
          <Card className="overflow-hidden shadow-card">
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 py-2.5 md:px-5">
                <p className="text-sm font-medium">
                  {t(
                    selectedIds.size === 1
                      ? 'transactions.selectedCount_one'
                      : 'transactions.selectedCount_other',
                    { count: selectedIds.size },
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                    {t('transactions.clearSelection')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setBulkConfirmOpen(true)}
                    disabled={deleting}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('transactions.deleteSelected')}
                  </Button>
                </div>
              </div>
            )}

            {loading && items.length === 0 ? (
              <div className="space-y-2 p-5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-2 py-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 && !error ? (
              <div className="p-7">
                <EmptyState
                  icon={<ReceiptText className="h-8 w-8" />}
                  title={t('transactions.noTitle')}
                  description={t('transactions.noDesc')}
                  action={
                    <Button onClick={() => openCreate('expense')}>
                      <Plus className="h-4 w-4" />
                      {t('transactions.newTransaction')}
                    </Button>
                  }
                />
              </div>
            ) : visible.length === 0 ? (
              <div className="p-7">
                <EmptyState
                  icon={<SearchX className="h-8 w-8" />}
                  title={t('transactions.noMatches')}
                  description={t('transactions.noMatchesDesc', { query })}
                  action={
                    <Button variant="outline" onClick={clearAll}>
                      {t('transactions.filters.clear')}
                    </Button>
                  }
                />
              </div>
            ) : (
              <>
                {/* Phones: grouped list with month headings */}
                <div className="md:hidden">
                  {monthGroups.map((group) => (
                    <section key={group.key}>
                      <h3 className="bg-muted/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
                        {group.label}
                      </h3>
                      <ul className="divide-y divide-border/60">
                        {group.items.map((tx) => (
                          <TransactionListRow
                            key={tx.id}
                            tx={tx}
                            category={tx.category_id ? categoryById.get(tx.category_id) : undefined}
                            accountName={
                              tx.account_id
                                ? accounts.find((a) => a.id === tx.account_id)?.name
                                : undefined
                            }
                            accountIconName={
                              tx.account_id ? accounts.find((a) => a.id === tx.account_id)?.icon : undefined
                            }
                            accountKind={
                              tx.account_id
                                ? accounts.find((a) => a.id === tx.account_id)?.account_kind
                                : undefined
                            }
                            onEdit={() => openEdit(tx)}
                            onDelete={() => setPendingDelete(tx)}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block">
                  <Table className="[&_td:first-child]:pl-5 [&_th:first-child]:pl-5 [&_td:last-child]:pr-7 [&_th:last-child]:pr-7">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allSelected}
                            indeterminate={someSelected}
                            onChange={(event) => toggleAll(event.target.checked)}
                            aria-label={t('transactions.selectAll')}
                          />
                        </TableHead>
                        <TableHead>{sortHeader('date', t('transactions.table.date'))}</TableHead>
                        <TableHead>{sortHeader('category', t('transactions.table.category'))}</TableHead>
                        <TableHead>{sortHeader('description', t('transactions.table.description'))}</TableHead>
                        <TableHead>{sortHeader('account', t('transactions.table.account'))}</TableHead>
                        <TableHead className="text-right">{sortHeader('amount', t('transactions.table.amount'))}</TableHead>
                        <TableHead className="w-24 text-right">{t('transactions.table.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((tx) => {
                        const cat = tx.category_id ? categoryById.get(tx.category_id) : undefined;
                        const isIncome = tx.type === 'income';
                        const selected = selectedIds.has(tx.id);
                        return (
                          <TableRow key={tx.id} data-state={selected ? 'selected' : undefined}>
                            <TableCell className="w-10">
                              <Checkbox
                                checked={selected}
                                onChange={(event) => toggleRow(tx.id, event.target.checked)}
                                aria-label={t('transactions.selectRow')}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap align-middle">
                              <span className="block text-muted-foreground">{formatDate(tx.date)}</span>
                              {tx.card_due_date && tx.card_due_date !== tx.date && (
                                <span className="block text-xs text-dim">
                                  {t('transactions.billDue', { date: formatDate(tx.card_due_date) })}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {cat ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <CategoryIcon name={cat.icon} className="h-4 w-4" />
                                  <span className="text-sm">{cat.name}</span>
                                </span>
                              ) : (
                                <span className="text-dim">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">{tx.description}</span>
                              {tx.installment_plan_id && (
                                <Badge variant="secondary" className="ml-2">
                                  {t('transactions.installment')}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {tx.account_id ? (() => {
                                const account = accounts.find((item) => item.id === tx.account_id);
                                return account ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <AccountIcon
                                      name={account.icon}
                                      kind={account.account_kind}
                                      className="h-4 w-4"
                                    />
                                    <span>{account.name}</span>
                                  </span>
                                ) : <span className="text-dim">—</span>;
                              })() : <span className="text-dim">—</span>}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right font-semibold tabular-nums',
                                isIncome ? 'text-income' : 'text-expense',
                              )}
                            >
                              {isIncome ? '+' : '-'}
                              {formatMoney(tx.amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openEdit(tx)}
                                  aria-label={t('common.edit')}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => setPendingDelete(tx)}
                                  aria-label={t('common.delete')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {hasMore && (
                  <div className="flex justify-center border-t border-border p-4">
                    <Button
                      variant="outline"
                      onClick={() => void load(page + 1, true)}
                      disabled={loadingMore}
                    >
                      {loadingMore ? t('common.loading') : t('transactions.loadMore')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* Month summary + where the money went, beside the table. */}
        <div className="min-w-0">
          <TransactionsSidebar />
        </div>
      </div>

      {/* Add / edit dialog */}
      <TransactionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        categories={categories}
        accounts={accounts}
        editing={editing}
        initialType={formType}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          void refreshAll();
          toast({ title: t('transactions.saved'), variant: 'success' });
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('transactions.deleteTitle')}
        description={
          pendingDelete
            ? t('transactions.deleteMessage', {
                description: pendingDelete.description,
                amount: formatMoney(pendingDelete.amount),
              })
            : ''
        }
        busy={deleting}
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={bulkConfirmOpen}
        title={t('transactions.bulkDeleteTitle')}
        description={t('transactions.bulkDeleteMessage', { count: selectedIds.size })}
        busy={deleting}
        destructive
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setBulkConfirmOpen(false)}
      />
    </div>
  );
}

