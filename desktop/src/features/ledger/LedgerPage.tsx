import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Plus,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  createLedgerTransaction,
  fetchAccountsWithBalance,
  fetchLedgerTransactions,
  migrateSingleToDouble,
  type LedgerEntry,
  type LedgerTransaction,
  type MigrationResponse,
} from '@/lib/api';
import { DateField } from '@/components/DateField';
import { toIsoDate } from '@/lib/date-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { cn } from '@/lib/utils';
import { ToolsWorkspace } from '@/features/tools/ToolsWorkspace';

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-surface px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark] max-md:h-11 max-md:px-3';

const ROW_GRID =
  'lg:grid lg:grid-cols-[6.5rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_7.5rem_4.5rem] lg:items-center lg:gap-3';

/** Sum of the debits and credits of one ledger transaction. */
function entryTotals(entries: LedgerEntry[]): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    debit += Number.parseFloat(entry.debit_amount || '0');
    credit += Number.parseFloat(entry.credit_amount || '0');
  }
  return { debit, credit };
}

/** `true` when a transaction's debits equal its credits (double-entry rule). */
function isBalanced(transaction: LedgerTransaction): boolean {
  const { debit, credit } = entryTotals(transaction.entries);
  return Math.abs(debit - credit) < 0.005;
}

/** The account on the debit and credit side of a transaction. */
function sides(transaction: LedgerTransaction): { debit?: LedgerEntry; credit?: LedgerEntry } {
  return {
    debit: transaction.entries.find((entry) => Number.parseFloat(entry.debit_amount) > 0),
    credit: transaction.entries.find((entry) => Number.parseFloat(entry.credit_amount) > 0),
  };
}

/**
 * Accounting Ledger: the double-entry records behind the money screens.
 *
 * This is an inspection surface for advanced users — the Transactions screen
 * stays the way to manage everyday spending.
 */
export function LedgerPage() {
  const { t, formatMoney, formatDate } = useI18n();
  const { toast } = useToast();

  const [search, setSearch] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [selected, setSelected] = React.useState<LedgerTransaction | null>(null);
  const [migrateOpen, setMigrateOpen] = React.useState(false);
  const [migrating, setMigrating] = React.useState(false);
  const [migration, setMigration] = React.useState<MigrationResponse | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  const [formOpen, setFormOpen] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [date, setDate] = React.useState(() => toIsoDate(new Date()));
  const [debitAccountId, setDebitAccountId] = React.useState('');
  const [creditAccountId, setCreditAccountId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const ledgerQuery = useQuery({ queryKey: ['ledger'], queryFn: () => fetchLedgerTransactions() });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetchAccountsWithBalance(),
  });

  const transactions = React.useMemo(() => ledgerQuery.data ?? [], [ledgerQuery.data]);
  const accounts = React.useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  /** Filtering is local: the endpoint returns the whole ledger. */
  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (needle) {
        const haystack = [tx.description, ...tx.entries.map((e) => e.account_name ?? '')]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (accountId && !tx.entries.some((entry) => entry.account_id === accountId)) return false;
      if (from && tx.date < from) return false;
      if (to && tx.date > to) return false;
      return true;
    });
  }, [transactions, search, accountId, from, to]);

  const filtersActive = Boolean(search || accountId || from || to);

  // The indicator reflects what is on screen; the backend enforces the rule.
  const unbalanced = visible.filter((tx) => !isBalanced(tx)).length;

  const handleCreate = async () => {
    const parsed = Number.parseFloat(amount.replace(',', '.'));
    if (!description.trim() || !debitAccountId || !creditAccountId || !(parsed > 0)) {
      setError(t('ledger.validation.fill'));
      return;
    }
    if (debitAccountId === creditAccountId) {
      setError(t('ledger.validation.different'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const normalized = amount.replace(',', '.');
      await createLedgerTransaction({
        description: description.trim(),
        date,
        entries: [
          {
            account_id: debitAccountId,
            debit_amount: normalized,
            credit_amount: '0',
            description: t('ledger.debit'),
          },
          {
            account_id: creditAccountId,
            debit_amount: '0',
            credit_amount: normalized,
            description: t('ledger.credit'),
          },
        ],
      });
      setFormOpen(false);
      setDescription('');
      setDebitAccountId('');
      setCreditAccountId('');
      setAmount('');
      await ledgerQuery.refetch();
      toast({ title: t('ledger.created'), variant: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ledger.failedCreate'));
    } finally {
      setSaving(false);
    }
  };

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const res = await migrateSingleToDouble();
      setMigration(res);
      setMigrateOpen(false);
      await ledgerQuery.refetch();
      toast({
        title: t('ledger.migrated', { migrated: res.migrated, total: res.total_processed }),
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('ledger.migrationFailed'),
        variant: 'error',
      });
    } finally {
      setMigrating(false);
    }
  };


  return (
    <ToolsWorkspace>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-md:hidden">
            <h2 className="text-xl font-semibold">{t('ledger.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('ledger.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setMigrateOpen(true)}>
              {t('ledger.migrate')}
            </Button>
            <Button className="gap-1.5" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('ledger.newEntry')}
            </Button>
          </div>
        </div>

        {migration && (
          <Card className="border-border bg-surface shadow-card">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-semibold">{t('ledger.migrationDone')}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t('ledger.migrationSummary', {
                    migrated: migration.migrated,
                    failed: migration.failed,
                    skipped: migration.already_migrated,
                  })}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMigration(null)}>
                {t('common.close')}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <div className="flex items-center gap-2 md:contents">
            <div className="relative w-full min-w-[12rem] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('ledger.searchPlaceholder')}
                aria-label={t('ledger.searchPlaceholder')}
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
            <select
              className={`${SELECT_CLASS} max-md:w-full`}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              aria-label={t('ledger.filterAccount')}
            >
              <option value="">{t('ledger.allAccounts')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <Input
              type="date"
              className="w-[9.5rem] max-md:w-full"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label={t('receipts.filterFrom')}
            />
            <Input
              type="date"
              className="w-[9.5rem] max-md:w-full"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label={t('receipts.filterTo')}
            />
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="max-md:w-full"
                onClick={() => {
                  setSearch('');
                  setAccountId('');
                  setFrom('');
                  setTo('');
                }}
              >
                {t('receipts.clearFilters')}
              </Button>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-xs max-md:ml-0 max-md:w-full">
              {unbalanced === 0 ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-muted-foreground">{t('ledger.balanced')}</span>
                  <span className="font-medium text-success">{t('ledger.balancedShort')}</span>
                </>
              ) : (
                <>
                  <TriangleAlert className="h-3.5 w-3.5 text-warning" />
                  <span className="text-muted-foreground">
                    {t('ledger.unbalanced', { count: unbalanced })}
                  </span>
                </>
              )}
            </span>
          </div>
        </div>
        {ledgerQuery.isLoading ? (
          <Card className="space-y-3 p-5">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </Card>
        ) : transactions.length === 0 ? (
          <Card className="p-7">
            <EmptyState
              icon={<BookOpen className="h-8 w-8" />}
              title={t('ledger.emptyTitle')}
              description={t('ledger.emptyDesc')}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button className="gap-1.5" onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('ledger.newEntry')}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href="/transactions">{t('ledger.viewTransactions')}</a>
                  </Button>
                </div>
              }
            />
          </Card>
        ) : visible.length === 0 ? (
          <Card className="p-7">
            <EmptyState
              icon={<Search className="h-8 w-8" />}
              title={t('receipts.noMatches')}
              description={t('receipts.noMatchesDesc')}
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
              <span>{t('common.description')}</span>
              <span>{t('ledger.debitAccount')}</span>
              <span>{t('ledger.creditAccount')}</span>
              <span className="text-right">{t('common.amount')}</span>
              <span className="text-right">{t('ledger.status')}</span>
            </div>
            <ul className="divide-y divide-border/60">
              {visible.map((tx) => {
                const { debit, credit } = sides(tx);
                const totals = entryTotals(tx.entries);
                const balanced = isBalanced(tx);
                return (
                  <li key={tx.transaction_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(tx)}
                      className={cn(
                        'grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-primary/[0.045]',
                        ROW_GRID,
                      )}
                    >
                      <span className="text-sm text-muted-foreground">{formatDate(tx.date)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{tx.description}</span>
                        {tx.entries.length > 2 && (
                          <span className="block text-xs text-dim">
                            {t('ledger.entryCount', { count: tx.entries.length })}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 truncate text-sm">
                        {debit?.account_name ?? t('ledger.multiple')}
                      </span>
                      <span className="min-w-0 truncate text-sm">
                        {credit?.account_name ?? t('ledger.multiple')}
                      </span>
                      <span className="text-sm font-semibold tabular-nums lg:text-right">
                        {formatMoney(totals.debit)}
                      </span>
                      <span className="lg:text-right">
                        {balanced ? (
                          <CheckCircle2
                            className="ml-auto h-4 w-4 text-success"
                            aria-label={t('ledger.balancedShort')}
                          />
                        ) : (
                          <TriangleAlert
                            className="ml-auto h-4 w-4 text-warning"
                            aria-label={t('ledger.unbalancedShort')}
                          />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('ledger.detailTitle')}</DialogTitle>
              <DialogDescription>{selected?.description}</DialogDescription>
            </DialogHeader>
            {selected && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border border-border bg-surface-hover/30 px-3 py-2.5">
                    <p className="text-xs text-dim">{t('common.date')}</p>
                    <p className="mt-0.5 font-medium">{formatDate(selected.date)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-surface-hover/30 px-3 py-2.5">
                    <p className="text-xs text-dim">{t('common.amount')}</p>
                    <p className="mt-0.5 font-medium tabular-nums">
                      {formatMoney(entryTotals(selected.entries).debit)}
                    </p>
                  </div>
                </div>

                <ul className="space-y-2">
                  {selected.entries.map((entry) => {
                    const isDebit = Number.parseFloat(entry.debit_amount) > 0;
                    return (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <ArrowRight
                            className={cn(
                              'h-3.5 w-3.5 shrink-0',
                              isDebit ? 'text-info' : 'text-success',
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 truncate">
                            {entry.account_name ?? entry.account_id.slice(0, 8)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={cn('block text-xs', isDebit ? 'text-info' : 'text-success')}>
                            {isDebit ? t('ledger.debit') : t('ledger.credit')}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatMoney(isDebit ? entry.debit_amount : entry.credit_amount)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="flex items-center gap-1.5 text-sm">
                  {isBalanced(selected) ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-success">{t('ledger.balancedShort')}</span>
                    </>
                  ) : (
                    <>
                      <TriangleAlert className="h-4 w-4 text-warning" />
                      <span className="text-warning">{t('ledger.unbalancedShort')}</span>
                    </>
                  )}
                </div>

                <div className="space-y-1 border-t border-border pt-3 text-xs text-dim">
                  <p className="truncate">
                    {t('ledger.entryId')}:{' '}
                    <span className="font-mono">{selected.transaction_id}</span>
                  </p>
                  <p>
                    {t('ledger.recordedAt')}: {formatDate(selected.recorded_at.slice(0, 10))}
                  </p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        {/* Migration confirmation (advanced, secondary action) */}
        <Dialog open={migrateOpen} onOpenChange={(open) => !migrating && setMigrateOpen(open)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('ledger.migrateTitle')}</DialogTitle>
              <DialogDescription>{t('ledger.migrateBlurb')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMigrateOpen(false)} disabled={migrating}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleMigrate()} disabled={migrating}>
                {migrating ? t('common.loading') : t('common.continue')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={formOpen} onOpenChange={(next) => !saving && setFormOpen(next)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('ledger.form.title')}</DialogTitle>
              <DialogDescription>{t('ledger.form.blurb')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ledger-desc">{t('ledger.form.description')}</Label>
                <Input
                  id="ledger-desc"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t('ledger.form.descriptionPlaceholder')}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ledger-date">{t('common.date')}</Label>
                <DateField id="ledger-date" value={date} onChange={setDate} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ledger-debit">{t('ledger.form.debit')}</Label>
                  <select
                    id="ledger-debit"
                    className={`${SELECT_CLASS} w-full`}
                    value={debitAccountId}
                    onChange={(event) => setDebitAccountId(event.target.value)}
                  >
                    <option value="">— {t('ledger.form.select')} —</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ledger-credit">{t('ledger.form.credit')}</Label>
                  <select
                    id="ledger-credit"
                    className={`${SELECT_CLASS} w-full`}
                    value={creditAccountId}
                    onChange={(event) => setCreditAccountId(event.target.value)}
                  >
                    <option value="">— {t('ledger.form.select')} —</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ledger-amount">{t('ledger.form.amount')}</Label>
                <Input
                  id="ledger-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleCreate()} disabled={saving}>
                {saving ? t('common.saving') : t('ledger.form.createEntry')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ToolsWorkspace>
  );
}

