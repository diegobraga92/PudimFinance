import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Landmark, Plus, Search, SearchX } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  deleteAccount,
  fetchAccountsWithBalance,
  fetchCategories,
  fetchSummary,
  type AccountWithBalance,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AccountForm, type AccountKind } from './AccountForm';
import { AccountDetail } from './AccountDetail';
import { AccountsSummary } from './AccountsSummary';
import { AccountGroupCard } from './AccountGroupCard';
import { AccountDistributionCard } from './AccountDistributionCard';
import { InvestmentsSummaryCard } from './InvestmentsSummaryCard';
import { AccountQuickActions } from './AccountQuickActions';
import { TransferDialog } from './TransferDialog';
import { AdjustBalanceDialog } from './AdjustBalanceDialog';
import {
  ACCOUNT_GROUPS,
  accountAppearance,
  groupOf,
  isBalanceSheet,
  sortByKind,
  type AccountGroupKey,
} from './account-groups';
import { cn } from '@/lib/utils';

type TabKey = 'all' | AccountGroupKey;

/** Filter tabs: "All" plus one per account group. */
const TABS: {
  key: TabKey;
  labelKey:
    | 'accounts.tab.all'
    | 'accounts.tab.bank'
    | 'accounts.tab.liabilities'
    | 'accounts.tab.investments'
    | 'accounts.tab.other';
}[] = [
  { key: 'all', labelKey: 'accounts.tab.all' },
  { key: 'bank', labelKey: 'accounts.tab.bank' },
  { key: 'liabilities', labelKey: 'accounts.tab.liabilities' },
  { key: 'investments', labelKey: 'accounts.tab.investments' },
  { key: 'other', labelKey: 'accounts.tab.other' },
];

/** Skeleton shaped like the group list, so the layout does not jump. */
function AccountsListSkeleton() {
  return (
    <div>
      {[0, 1].map((group) => (
        <div key={group} className="border-t border-border first:border-t-0">
          <div className="flex items-center gap-3 bg-primary/[0.03] px-4 py-3.5">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="divide-y divide-border/60">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Accounts: where the money sits, what is owed and how it is spread.
 *
 * Balances and account kinds come from `GET /api/accounts` (the backend's
 * computed chart-of-accounts balances), the month's income from
 * `GET /api/summary`, activity from `GET /api/transactions`, and transfers post
 * to the double-entry ledger. Nothing is derived from raw ledger rows here.
 */
export function AccountsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = React.useState(false);
  const [formKind, setFormKind] = React.useState<AccountKind>('bank');
  const [editing, setEditing] = React.useState<AccountWithBalance | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<AccountWithBalance | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [detail, setDetail] = React.useState<AccountWithBalance | null>(null);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [adjusting, setAdjusting] = React.useState<AccountWithBalance | null>(null);
  const [tab, setTab] = React.useState<TabKey>('all');
  const [search, setSearch] = React.useState('');

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetchAccountsWithBalance(),
  });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const summaryQuery = useQuery({ queryKey: ['summary'], queryFn: () => fetchSummary() });

  const accounts = React.useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const categories = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const balanceSheet = React.useMemo(() => accounts.filter(isBalanceSheet), [accounts]);

  const totals = React.useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    let investments = 0;
    let liabilityCount = 0;
    for (const account of balanceSheet) {
      const balance = parseFloat(account.balance) || 0;
      if (account.type === 'liability') {
        liabilities += Math.abs(balance);
        liabilityCount += 1;
      } else {
        assets += balance;
        if (account.account_kind === 'investment') investments += balance;
      }
    }
    return { assets, liabilities, investments, liabilityCount };
  }, [balanceSheet]);

  const monthlyIncome = summaryQuery.data ? parseFloat(summaryQuery.data.income_total) : null;
  const monthlyExpenses = summaryQuery.data ? parseFloat(summaryQuery.data.expense_total) : null;
  const monthlyNet =
    monthlyIncome !== null && monthlyExpenses !== null ? monthlyIncome - monthlyExpenses : null;
  const hasCards = balanceSheet.some((account) => account.account_kind === 'card');

  const tabCounts = React.useMemo(() => {
    const counts: Record<TabKey, number> = {
      all: balanceSheet.length,
      bank: 0,
      liabilities: 0,
      investments: 0,
      other: 0,
    };
    for (const account of balanceSheet) counts[groupOf(account)] += 1;
    return counts;
  }, [balanceSheet]);

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return balanceSheet.filter((account) => {
      if (tab !== 'all' && groupOf(account) !== tab) return false;
      if (!needle) return true;
      const kindKey = accountAppearance(account).kindKey;
      const kindLabel = kindKey ? t(kindKey).toLowerCase() : '';
      return account.name.toLowerCase().includes(needle) || kindLabel.includes(needle);
    });
  }, [balanceSheet, tab, search, t]);

  const groups = React.useMemo(
    () =>
      ACCOUNT_GROUPS.map((meta) => ({
        meta,
        accounts: sortByKind(filtered.filter((account) => groupOf(account) === meta.key)),
      })).filter((group) => group.accounts.length > 0),
    [filtered],
  );


  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  }, [queryClient]);

  const openCreate = (kind: AccountKind) => {
    setEditing(null);
    setFormKind(kind);
    setFormOpen(true);
  };

  const openEdit = (account: AccountWithBalance) => {
    setEditing(account);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const target = pendingDelete;
    try {
      await deleteAccount(target.id);
      setPendingDelete(null);
      await refresh();
      toast({ title: t('accounts.deleted', { name: target.name }) });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('accounts.failedDelete'),
        variant: 'error',
      });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleTransferSaved = async () => {
    // A transfer only moves ledger entries: balances and the ledger change,
    // income/expense totals do not.
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    toast({ title: t('accounts.transfer.saved'), variant: 'success' });
  };

  const loading = accountsQuery.isLoading;
  const canTransfer = balanceSheet.length >= 2;


  const showEmptyState = !loading && balanceSheet.length === 0;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        titleKey="nav.accounts"
        subtitleKey="accounts.subtitle"
        actions={
          <>
            <Button
              variant="outline"
              className="gap-1.5 text-primary"
              onClick={() => setTransferOpen(true)}
              disabled={!canTransfer}
              title={canTransfer ? undefined : t('accounts.transfer.needTwo')}
              aria-label={t('accounts.transfer')}
            >
              <ArrowLeftRight className="h-4 w-4" />
              <span className="max-md:hidden">{t('accounts.transfer')}</span>
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => openCreate('bank')}
              aria-label={t('accounts.newAccount')}
            >
              <Plus className="h-4 w-4" />
              <span className="max-md:hidden">{t('accounts.newAccount')}</span>
            </Button>
          </>
        }
      />

      {showEmptyState ? (
        <Card className="p-7">
          <EmptyState
            icon={<Landmark className="h-8 w-8" />}
            title={t('accounts.noTitle')}
            description={t('accounts.noDesc')}
            action={
              <Button className="gap-1.5" onClick={() => openCreate('bank')}>
                <Plus className="h-4 w-4" />
                {t('accounts.newAccount')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <AccountsSummary
            loading={loading || summaryQuery.isLoading}
            available={accountsQuery.data !== undefined}
            totalAssets={totals.assets}
            investments={totals.investments}
            totalLiabilities={totals.liabilities}
            liabilityCount={totals.liabilityCount}
            monthlyIncome={monthlyIncome}
            monthlyExpenses={monthlyExpenses}
            monthlyNet={monthlyNet}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,1fr)]">
            {/* One box holds the filters and every account group. */}
            <Card className="overflow-hidden shadow-card">
              <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 md:p-5">
                <div className="-mx-1 flex gap-1 overflow-x-auto rounded-md bg-muted p-1 px-1 max-md:w-full md:flex-wrap">
                  {TABS.map(({ key, labelKey }) => {
                    const active = tab === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        aria-pressed={active}
                        className={cn(
                          'shrink-0 rounded-sm px-3 py-2 text-xs font-medium transition-colors md:py-1.5',
                          active
                            ? 'bg-surface text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {t(labelKey)}
                        <span className="ml-1.5 tabular-nums text-dim">{tabCounts[key]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('accounts.search')}
                    aria-label={t('accounts.searchAria')}
                  />
                </div>
              </div>

              {loading ? (
                <AccountsListSkeleton />
              ) : groups.length === 0 ? (
                <div className="p-7">
                  <EmptyState
                    icon={<SearchX className="h-8 w-8" />}
                    title={t('accounts.noMatches')}
                    description={t('accounts.noMatchesDesc')}
                  />
                </div>
              ) : (
                <div>
                  {groups.map((group) => (
                    <AccountGroupCard
                      key={group.meta.key}
                      meta={group.meta}
                      accounts={group.accounts}
                      onView={setDetail}
                      onEdit={openEdit}
                      onDelete={setPendingDelete}
                      onAdjust={setAdjusting}
                    />
                  ))}
                </div>
              )}
            </Card>

            {/* Sidebar: distribution, investments and shortcuts. Recent activity
             * is not repeated here — the dashboard already shows it. */}
            <div className="flex flex-col gap-4">
              <AccountDistributionCard accounts={balanceSheet} loading={loading} />
              <InvestmentsSummaryCard accounts={balanceSheet} loading={loading} />
              <AccountQuickActions
                onNewAccount={() => openCreate('bank')}
                onNewInvestment={() => openCreate('investment')}
                onTransfer={() => setTransferOpen(true)}
                canTransfer={canTransfer}
                hasCards={hasCards}
              />
            </div>
          </div>
        </>
      )}


      <AccountForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        initialKind={formKind}
        onSaved={(name) => {
          const label = editing
            ? t('accounts.updated', { name: editing.name })
            : t('accounts.created', { name });
          setFormOpen(false);
          setEditing(null);
          void refresh();
          toast({ title: label, variant: 'success' });
        }}
      />

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        accounts={balanceSheet}
        onSaved={() => void handleTransferSaved()}
      />

      <AdjustBalanceDialog
        open={adjusting !== null}
        account={adjusting}
        onOpenChange={(open) => !open && setAdjusting(null)}
        onSaved={() => {
          setAdjusting(null);
          void queryClient.invalidateQueries({ queryKey: ['accounts'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          void queryClient.invalidateQueries({ queryKey: ['ledger'] });
          toast({ title: t('accounts.adjust.saved'), variant: 'success' });
        }}
      />

      {detail && (
        <AccountDetail
          account={detail}
          categories={categories}
          open
          onClose={() => setDetail(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('accounts.deleteTitle', { name: pendingDelete?.name ?? '' })}
        description={t('accounts.deleteMessage')}
        busy={deleting}
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

