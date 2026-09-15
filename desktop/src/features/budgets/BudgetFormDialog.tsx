import * as React from 'react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CategoryIcon } from '@/components/CategoryIcon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createBudget, type BudgetSummaryItem, type Category } from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `overall` edits the single monthly limit; `category` a per-category limit. */
  mode: 'category' | 'overall';
  month: number;
  year: number;
  /** Expense categories available for a category budget. */
  categories: Category[];
  /**
   * Categories that already have a limit, or whose parent/subcategory has one:
   * the backend rejects those combinations, so they are hidden here.
   */
  blockedCategoryIds: Set<string>;
  /** The budget being edited (null when creating). */
  editing: BudgetSummaryItem | null;
  onSaved: () => void;
}

/**
 * Create or edit a monthly limit through `POST /api/budgets` (an upsert, so the
 * same call covers both). The period comes from the page's month selector.
 */
export function BudgetFormDialog({
  open,
  onOpenChange,
  mode,
  month,
  year,
  categories,
  blockedCategoryIds,
  editing,
  onSaved,
}: Props) {
  const { t, monthNames } = useI18n();

  const [categoryId, setCategoryId] = React.useState('');
  const [limit, setLimit] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const selectable = React.useMemo(
    () =>
      categories.filter(
        (c) => !blockedCategoryIds.has(c.id) || c.id === editing?.budget.category_id,
      ),
    [categories, blockedCategoryIds, editing],
  );

  React.useEffect(() => {
    if (!open) return;
    setCategoryId(editing?.budget.category_id ?? selectable[0]?.id ?? '');
    setLimit(editing ? editing.budget.amount_limit : '');
    setError(null);
    setSaving(false);
  }, [open, editing, selectable]);

  const period = `${monthNames[month - 1]} ${year}`;
  const nothingToPick = mode === 'category' && selectable.length === 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = limit.trim().replace(',', '.');
    const amount = Number.parseFloat(normalized);
    if (mode === 'category' && !categoryId) {
      setError(t('budgets.validation.category'));
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('budgets.validation.amount'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createBudget({
        category_id: mode === 'overall' ? null : categoryId,
        month,
        year,
        amount_limit: normalized,
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('budgets.failedSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'overall'
              ? t(editing ? 'budgets.form.editOverall' : 'budgets.form.addOverall')
              : editing
                ? t('budgets.form.edit', {
                    name: editing.budget.category_name ?? t('common.uncategorised'),
                  })
                : t('budgets.form.add')}
          </DialogTitle>
          <DialogDescription>
            {t('common.appliesTo', { month: monthNames[month - 1], year })}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {mode === 'category' ? (
            nothingToPick ? (
              <p className="text-sm text-dim">{t('budgets.form.noCategories')}</p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="budget-category">{t('budgets.form.category')}</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="budget-category">
                    <SelectValue placeholder={t('budgets.form.selectCategory')} />
                  </SelectTrigger>
                  <SelectContent className="z-[60]">
                  {selectable.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      <span className="flex items-center gap-2">
                        <CategoryIcon name={category.icon} className="h-4 w-4" />
                        {category.name}
                      </span>
                    </SelectItem>
                  ))}
                  </SelectContent>
                </Select>
              </div>
            )
          ) : (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {t('budgets.form.overallHint', { period })}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="budget-limit">{t('budgets.form.monthlyLimit')}</Label>
            <Input
              id="budget-limit"
              inputMode="decimal"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="500.00"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving || nothingToPick}>
              {saving
                ? t('common.saving')
                : editing
                  ? t('budgets.form.saveChanges')
                  : t('budgets.form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

