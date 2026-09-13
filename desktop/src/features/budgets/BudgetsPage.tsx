import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  acknowledgeAllBudgetAlerts,
  acknowledgeBudgetAlert,
  createBudget,
  deleteBudget,
  fetchBudgetAlerts,
  fetchBudgetSummary,
  fetchCategories,
  type BudgetSummaryItem,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { categoryIcon } from '@shared/category-icons';
import { cn } from '@/lib/utils';

export function BudgetsPage() {
  const { t, formatMoney, monthNames } = useI18n();
  const { toast } = useToast();

  const now = new Date();
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth() + 1);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BudgetSummaryItem | null>(null);
  const [formCategory, setFormCategory] = React.useState('');
  const [formLimit, setFormLimit] = React.useState('');
  const [formSaving, setFormSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<BudgetSummaryItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const summaryQuery = useQuery({
    queryKey: ['budget-summary', year, month],
    queryFn: () => fetchBudgetSummary(year, month),
  });
  const alertsQuery = useQuery({
    queryKey: ['budget-alerts'],
    queryFn: () => fetchBudgetAlerts({ acknowledged: false }),
  });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const categories = categoriesQuery.data ?? [];
  const expenseCategories = categories.filter((c) => c.type === 'expense');

  const summary = summaryQuery.data;
  const items = summary?.items ?? [];

  const isFutureMonth =
    year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    if (isFutureMonth) return;
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormCategory('');
    setFormLimit('');
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (item: BudgetSummaryItem) => {
    setEditing(item);
    setFormCategory(item.budget.category_id);
    setFormLimit(item.budget.amount_limit);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!formCategory) {
      setFormError(t('budgets.validation.category'));
      return;
    }
    const limitNum = parseFloat(formLimit.replace(',', '.'));
    if (!(limitNum > 0)) {
      setFormError(t('budgets.validation.amount'));
      return;
    }
    setFormSaving(true);
    setFormError(null);
    try {
      if (editing) {
        // Recreating the budget for the same month/category is safe because the
        // backend upserts budgets by (category, month, year) on create.
        await createBudget({
          category_id: formCategory,
          amount_limit: formLimit.replace(',', '.'),
          month: editing.budget.month,
          year: editing.budget.year,
        });
      } else {
        await createBudget({
          category_id: formCategory,
          amount_limit: formLimit.replace(',', '.'),
          month,
          year,
        });
      }
      setFormOpen(false);
      setEditing(null);
      await Promise.all([
        summaryQuery.refetch(),
        alertsQuery.refetch(),
        categoriesQuery.refetch(),
      ]);
      toast({ title: t('budgets.saved'), variant: 'success' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('budgets.failedSave'));
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteBudget(pendingDelete.budget.id);
      setPendingDelete(null);
      await summaryQuery.refetch();
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

  const handleAck = async (id: string) => {
    try {
      await acknowledgeBudgetAlert(id);
      await alertsQuery.refetch();
      toast({ title: t('budgets.alertAcknowledged') });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('budgets.failedAck'),
        variant: 'error',
      });
    }
  };

  const handleAckAll = async () => {
    try {
      await acknowledgeAllBudgetAlerts();
      await alertsQuery.refetch();
      toast({ title: t('budgets.alertsAcknowledged') });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t('budgets.failedAckAll'),
        variant: 'error',
      });
    }
  };

  const alerts = alertsQuery.data;
  const unacknowledgedCount = alerts?.unacknowledged_count ?? 0;

  const totalRemaining = parseFloat(summary?.total_budgeted ?? '0') - parseFloat(summary?.total_spent ?? '0');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.budgets')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('budgets.subtitle')}</p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={expenseCategories.length === 0}>
          <Plus className="h-4 w-4" />
          {t('budgets.add')}
        </Button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">
            {monthNames[month - 1]} {year}
          </p>
          <p className="text-xs text-dim">{t('common.appliesTo', { month: monthNames[month - 1], year })}</p>
        </div>
        <Button variant="outline" size="sm" onClick={nextMonth} disabled={isFutureMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Budget alerts */}
      {alerts && alerts.items.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BellRing className="h-4 w-4 text-warning" />
              {t('budgets.alertsTitle')}
              {unacknowledgedCount > 0 && (
                <Badge variant="warning">{unacknowledgedCount}</Badge>
              )}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void handleAckAll()}>
              {t('budgets.acknowledgeAll')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.items.map((alert) => {
              const pct = Math.round(
                (parseFloat(alert.actual_spent) / Math.max(parseFloat(alert.amount_limit), 0.01)) * 100,
              );
              const over = pct >= 100;
              return (
                <div key={alert.id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                  <span className="text-base">{categoryIcon(alert.category_icon)}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{alert.category_name}</span>
                    <span className={cn('ml-2', over ? 'text-expense' : 'text-warning')}>
                      {t('budgets.spentOf', {
                        spent: formatMoney(alert.actual_spent),
                        limit: formatMoney(alert.amount_limit),
                        pct,
                      })}
                      {' — '}
                      {over ? t('common.overBudget') : t('common.nearLimit')}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void handleAck(alert.id)}>
                    {t('budgets.acknowledge')}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Overview cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('budgets.totalBudgeted')}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(summary?.total_budgeted ?? 0)}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('budgets.totalSpent')}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-expense">{formatMoney(summary?.total_spent ?? 0)}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('budgets.remaining')}</p>
          <p className={cn('mt-1 text-lg font-semibold tabular-nums', totalRemaining >= 0 ? 'text-income' : 'text-expense')}>
            {formatMoney(totalRemaining)}
          </p>
        </div>
      </div>


      {/* Budget list */}
      {summaryQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">
              {t('budgets.noTitle', { month: monthNames[month - 1], year })}
            </p>
            <p className="max-w-md text-sm text-dim">{t('budgets.noDesc')}</p>
            <Button className="mt-2" size="sm" onClick={openCreate} disabled={expenseCategories.length === 0}>
              <Plus className="h-4 w-4" />
              {t('budgets.add')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t('common.appliesTo', { month: monthNames[month - 1], year })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.map((item) => {
              const pct = parseFloat(item.percentage);
              const over = pct >= 100;
              const budget = item.budget;
              return (
                <div key={budget.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="text-base">{categoryIcon(budget.icon)}</span>
                      <span className="font-medium">{budget.category_name}</span>
                      <span
                        className={cn(
                          'text-xs',
                          over ? 'text-expense' : pct >= 80 ? 'text-warning' : 'text-income',
                        )}
                      >
                        {over
                          ? t('budgets.overAmount', { amount: formatMoney(item.remaining) })
                          : t('budgets.remainingAmount', { amount: formatMoney(item.remaining) })}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">
                        {formatMoney(item.actual_spent)} / {formatMoney(budget.amount_limit)}
                      </span>
                      <Badge variant={over ? 'expense' : pct >= 80 ? 'warning' : 'secondary'}>
                        {Math.round(pct)}%
                      </Badge>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(item)}
                          aria-label={t('common.edit')}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDelete(item)}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </span>
                  </div>
                  <Progress
                    value={Math.min(pct, 100)}
                    className="h-2"
                    indicatorClassName={cn(
                      over ? 'bg-expense' : pct >= 80 ? 'bg-warning' : 'bg-income',
                    )}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}


      {/* Budget form */}
      <Dialog open={formOpen} onOpenChange={(next) => !formSaving && setFormOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('budgets.form.edit', { name: editing.budget.category_name }) : t('budgets.form.add')}
            </DialogTitle>
            <DialogDescription>
              {t('common.appliesTo', {
                month: monthNames[(editing?.budget.month ?? month) - 1],
                year: editing?.budget.year ?? year,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            {expenseCategories.length === 0 ? (
              <p className="text-sm text-dim">{t('budgets.form.noCategories')}</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="budget-cat">{t('budgets.form.category')}</Label>
                  <select
                    id="budget-cat"
                    className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                  >
                    <option value="">— {t('budgets.form.selectCategory')} —</option>
                    {expenseCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon ? `${categoryIcon(c.icon)} ` : ''}
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="budget-limit">{t('budgets.form.monthlyLimit')}</Label>
                  <Input
                    id="budget-limit"
                    inputMode="decimal"
                    value={formLimit}
                    onChange={(e) => setFormLimit(e.target.value)}
                    placeholder="500.00"
                    autoFocus={!editing}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={formSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={formSaving || expenseCategories.length === 0}
            >
              {formSaving
                ? t('common.saving')
                : editing
                  ? t('budgets.form.saveChanges')
                  : t('budgets.form.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('budgets.deleteTitle')}
        description={
          pendingDelete
            ? t('budgets.deleteMessage', {
                category: pendingDelete.budget.category_name,
                month: monthNames[pendingDelete.budget.month - 1],
                year: pendingDelete.budget.year,
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

