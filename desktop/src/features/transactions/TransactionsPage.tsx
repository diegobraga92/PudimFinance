import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Download, Filter, Pencil, Plus, Search, Trash2 } from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { TransactionForm } from './TransactionForm';
import { categoryIcon } from '@shared/category-icons';
import { refreshWidgetSpentToday } from '@/lib/widget';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

export function TransactionsPage() {
  const { t, formatMoney, formatDate } = useI18n();
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

  const [items, setItems] = React.useState<Transaction[]>([]);
  const [page, setPage] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetchAccountsWithBalance(),
  });
  const categories = categoriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const load = React.useCallback(
    async (nextPage: number, append: boolean) => {
      if (nextPage === 0) setLoadingMore(false);
      else setLoadingMore(true);
      setError(null);
      try {
        const filters: TransactionFilters = { page: nextPage, page_size: PAGE_SIZE };
        if (filterType !== 'all') filters.type = filterType;
        if (startDate) filters.start_date = startDate;
        if (endDate) filters.end_date = endDate;
        if (filterCategory) filters.category_id = filterCategory;
        const res = await fetchTransactions(filters);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setPage(res.page);
        setHasMore(res.page * PAGE_SIZE + res.items.length < res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.loadTransactions'));
      } finally {
        setLoadingMore(false);
      }
    },
    [t, filterType, startDate, endDate, filterCategory],
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
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.transactions')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length > 0 ? t('transactions.search') : t('transactions.noDesc')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0}>
            <Download className="h-4 w-4" />
            {t('transactions.export')}
          </Button>
          <Button size="sm" onClick={() => openCreate('expense')}>
            <Plus className="h-4 w-4" />
            {t('transactions.addShort')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('transactions.search')}
          aria-label={t('transactions.searchAria')}
        />
      </div>

      {/* Server-side filters (type, date range, category) */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tx-filter-type">{t('transactions.filters.allTypes')}</Label>
          <select
            id="tx-filter-type"
            className="flex h-9 rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'all' | 'income' | 'expense')}
          >
            <option value="all">{t('transactions.filters.allTypes')}</option>
            <option value="income">{t('transactions.filters.income')}</option>
            <option value="expense">{t('transactions.filters.expense')}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-filter-from">{t('transactions.filters.from')}</Label>
          <Input
            id="tx-filter-from"
            type="date"
            className="h-9"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-filter-to">{t('transactions.filters.to')}</Label>
          <Input
            id="tx-filter-to"
            type="date"
            className="h-9"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-filter-category">{t('transactions.filters.category')}</Label>
          <select
            id="tx-filter-category"
            className="flex h-9 rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">{t('transactions.filters.allCategories')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <Filter className="h-4 w-4" />
            {t('transactions.filters.clear')}
          </Button>
        )}
      </div>

      {/* Table */}
      {items.length === 0 && !error ? (
        <div className="card-surface flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm font-medium">{t('transactions.noTitle')}</p>
          <p className="max-w-sm text-sm text-dim">{t('transactions.noDesc')}</p>
          <Button className="mt-2" size="sm" onClick={() => openCreate('expense')}>
            <Plus className="h-4 w-4" />
            {t('transactions.firstOne')}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="card-surface flex flex-col items-center justify-center gap-1 py-16 text-center">
          <p className="text-sm font-medium">{t('transactions.noMatches')}</p>
          <p className="text-sm text-dim">{t('transactions.noMatchesDesc', { query })}</p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('common.description')}</TableHead>
                  <TableHead>{t('common.category')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead className="w-24 text-right">{t('common.items')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((tx) => {
                  const cat = tx.category_id ? categoryById.get(tx.category_id) : undefined;
                  const isIncome = tx.type === 'income';
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{tx.description}</span>
                        {tx.installment_plan_id && (
                          <Badge variant="secondary" className="ml-2">
                            {t('transactions.installment')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {cat ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-base">{categoryIcon(cat.icon)}</span>
                            <span className="text-sm">{cat.name}</span>
                          </span>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
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
            <div className="flex justify-center border-t border-border p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load(page + 1, true)}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.loading') : t('transactions.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

