import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  acknowledgeAllBudgetAlerts,
  acknowledgeBudgetAlert,
  deleteBudget,
  fetchBudgetAlerts,
  fetchBudgetSummary,
  fetchCategories,
  fetchSummary,
  type BudgetSummaryItem,
} from '@/lib/api';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { BudgetAlertsCard } from './BudgetAlertsCard';
import { BudgetFormDialog } from './BudgetFormDialog';
import { BudgetOverviewCard } from './BudgetOverviewCard';
import { BudgetQuickActions } from './BudgetQuickActions';
import { BudgetSummaryCards, type BudgetTotals } from './BudgetSummaryCards';
import { CategoryBudgetsCard } from './CategoryBudgetsCard';

/** Asks the tab to open the budget form (the page header owns the button). */
export interface BudgetFormRequest {
  mode: 'category' | 'overall';
  editing?: BudgetSummaryItem | null;
}

interface Props {
  year: number;
  month: number;
  monthLabel: string;
  /** Set by the page when its "Add budget" button asks for the form. */
  formRequest: BudgetFormRequest | null;
  onFormHandled: () => void;
  onViewCategory: (name: string) => void;
}

/**
 * Budgets tab: the month's limits, how much is left, what is in trouble and
 * where the money went. All figures come from `GET /api/budgets/summary`,
 * `GET /api/summary` and `GET /api/budgets/alerts`.
 */
export function BudgetsTab({
  year,
  month,
  monthLabel,
  formRequest,
  onFormHandled,
  onViewCategory,
}: Props) {
  const { t, monthNames } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formMode, setFormMode] = React.useState<'category' | 'overall'>('category');
  const [formEditing, setFormEditing] = React.useState<BudgetSummaryItem | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<BudgetSummaryItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [acknowledging, setAcknowledging] = React.useState(false);
  const [showAllAlerts, setShowAllAlerts] = React.useState(false);

  const budgetQuery = useQuery({
    queryKey: ['budget-summary', year, month],
    queryFn: () => fetchBudgetSummary(year, month),
  });
  const alertsQuery = useQuery({
    queryKey: ['budget-alerts'],
    queryFn: () => fetchBudgetAlerts({ acknowledged: false }),
  });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const summaryQuery = useQuery({
    queryKey: ['summary', year, month],
    queryFn: () => fetchSummary({ month, year }),
  });

  const items = React.useMemo(() => budgetQuery.data?.items ?? [], [budgetQuery.data]);
  const overall = budgetQuery.data?.overall ?? null;
  const alerts = React.useMemo(() => alertsQuery.data?.items ?? [], [alertsQuery.data]);
  const categories = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  /** Direct subcategory count per category (shown on a parent's budget row). */
  const childrenCount = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) {
      if (!category.parent_id) continue;
      counts.set(category.parent_id, (counts.get(category.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [categories]);

  /**
   * Categories that already have a limit — directly, through an ancestor or
   * through a subcategory. The backend rejects overlapping limits, so the form
   * leaves them out instead of offering a choice that would fail.
   */
  const blockedCategoryIds = React.useMemo(() => {
    const blocked = new Set<string>();
    const byId = new Map(categories.map((category) => [category.id, category]));
    const childrenOf = new Map<string, string[]>();
    for (const category of categories) {
      if (!category.parent_id) continue;
      const list = childrenOf.get(category.parent_id) ?? [];
      list.push(category.id);
      childrenOf.set(category.parent_id, list);
    }

    for (const item of items) {
      const id = item.budget.category_id;
      if (!id) continue;
      blocked.add(id);

      const stack = [id];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) break;
        for (const child of childrenOf.get(current) ?? []) {
          if (!blocked.has(child)) {
            blocked.add(child);
            stack.push(child);
          }
        }
      }

      let parentId = byId.get(id)?.parent_id ?? null;
      while (parentId) {
        blocked.add(parentId);
        parentId = byId.get(parentId)?.parent_id ?? null;
      }
    }
    return blocked;
  }, [items, categories]);

  const totals: BudgetTotals = React.useMemo(() => {
    const limit = items.reduce(
      (sum, item) => sum + (Number.parseFloat(item.budget.amount_limit) || 0),
      0,
    );
    const spent = items.reduce((sum, item) => sum + (Number.parseFloat(item.actual_spent) || 0), 0);
    const overById = new Map(
      items.map((item) => [item.budget.id, Number.parseFloat(item.remaining) < 0]),
    );
    const alertsOver = alerts.filter((alert) => overById.get(alert.budget_id) === true).length;

    return {
      hasOverall: overall !== null,
      limit: overall ? Number.parseFloat(overall.budget.amount_limit) || 0 : limit,
      spent: overall ? Number.parseFloat(overall.actual_spent) || 0 : spent,
      categoryBudgetCount: items.length,
      alertsTotal: alerts.length,
      alertsOver,
    };
  }, [items, overall, alerts]);

  const invalidateBudgets = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['budget-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['budget-alerts'] });
  }, [queryClient]);

  const openForm = React.useCallback(
    (mode: 'category' | 'overall', editing: BudgetSummaryItem | null) => {
      setFormMode(mode);
      setFormEditing(editing);
      setFormOpen(true);
    },
    [],
  );

  // The page header owns the "Add budget" button; it asks the tab to open the form.
  React.useEffect(() => {
    if (!formRequest) return;
    openForm(formRequest.mode, formRequest.editing ?? null);
    onFormHandled();
  }, [formRequest, onFormHandled, openForm]);

  const handleSaved = async () => {
    setFormOpen(false);
    setFormEditing(null);
    await invalidateBudgets();
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    toast({ title: t('budgets.saved'), variant: 'success' });
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteBudget(pendingDelete.budget.id);
      setPendingDelete(null);
      await invalidateBudgets();
      toast({ title: t('budgets.deleted') });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('budgets.failedDelete'),
        variant: 'error',
      });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleAcknowledge = async (id: string) => {
    setAcknowledging(true);
    try {
      await acknowledgeBudgetAlert(id);
      await queryClient.invalidateQueries({ queryKey: ['budget-alerts'] });
      toast({ title: t('budgets.alertAcknowledged') });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('budgets.failedAck'),
        variant: 'error',
      });
    } finally {
      setAcknowledging(false);
    }
  };

  const handleAcknowledgeAll = async () => {
    setAcknowledging(true);
    try {
      await acknowledgeAllBudgetAlerts();
      await queryClient.invalidateQueries({ queryKey: ['budget-alerts'] });
      toast({ title: t('budgets.alertsAcknowledged') });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('budgets.failedAckAll'),
        variant: 'error',
      });
    } finally {
      setAcknowledging(false);
    }
  };

  const loading = budgetQuery.isLoading;
  const loadFailed = budgetQuery.isError;

  return (
    <div className="space-y-4">
      {loadFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p>{t('budgets.failedLoad')}</p>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive"
            onClick={() => void budgetQuery.refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}

      <BudgetSummaryCards
        loading={loading}
        totals={totals}
        monthLabel={monthLabel}
        onSetOverall={() => openForm('overall', overall)}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(300px,1fr)]">
        <CategoryBudgetsCard
          items={items}
          loading={loading}
          month={month}
          year={year}
          childrenCount={childrenCount}
          onAdd={() => openForm('category', null)}
          onEdit={(item) => openForm('category', item)}
          onRemove={setPendingDelete}
          onViewCategory={onViewCategory}
        />

        <div className="flex flex-col gap-4">
          <BudgetOverviewCard
            items={summaryQuery.data?.by_category ?? []}
            total={Number.parseFloat(summaryQuery.data?.expense_total ?? '0') || 0}
            loading={summaryQuery.isLoading}
            year={year}
            month={month}
          />
          <BudgetAlertsCard
            alerts={alerts}
            items={items}
            loading={alertsQuery.isLoading}
            acknowledging={acknowledging}
            showingAll={showAllAlerts}
            onToggleAll={() => setShowAllAlerts((value) => !value)}
            onAcknowledge={(id) => void handleAcknowledge(id)}
            onAcknowledgeAll={() => void handleAcknowledgeAll()}
            onViewCategory={onViewCategory}
          />
          <BudgetQuickActions
            hasOverall={totals.hasOverall}
            onAddCategoryBudget={() => openForm('category', null)}
            onSetOverall={() => openForm('overall', overall)}
            onManageCategories={() => onViewCategory('')}
          />
        </div>
      </div>

      <BudgetFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        month={month}
        year={year}
        categories={categories.filter((category) => category.type === 'expense')}
        blockedCategoryIds={blockedCategoryIds}
        editing={formEditing}
        onSaved={() => void handleSaved()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('budgets.deleteTitle')}
        description={
          pendingDelete
            ? t('budgets.deleteMessage', {
                category: pendingDelete.budget.category_name ?? t('common.uncategorised'),
                month: monthNames[month - 1],
                year,
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

