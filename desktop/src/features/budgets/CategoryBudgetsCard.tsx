import { Eye, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { BudgetSummaryItem } from '@/lib/api';
import { CategoryIcon } from '@/components/CategoryIcon';
import {
  HEALTH_BAR,
  HEALTH_TEXT,
  budgetHealth,
  budgetPercent,
  budgetRemaining,
} from './budget-health';

interface Props {
  items: BudgetSummaryItem[];
  loading: boolean;
  month: number;
  year: number;
  /** Number of subcategories per category id (for the "covers" hint). */
  childrenCount: Map<string, number>;
  onAdd: () => void;
  onEdit: (item: BudgetSummaryItem) => void;
  onRemove: (item: BudgetSummaryItem) => void;
  onViewCategory: (name: string) => void;
}

/** Desktop column template, mirrored by the header row and every budget row. */
const ROW_COLUMNS =
  'lg:grid lg:grid-cols-[minmax(0,2fr)_0.9fr_0.9fr_1.5fr_1fr_2.5rem] lg:items-center lg:gap-4';


/**
 * The month's category limits: spent vs budget with a health-coloured bar and
 * the remaining amount. Rows reflow into labelled blocks on narrow screens.
 */
export function CategoryBudgetsCard({
  items,
  loading,
  month,
  year,
  childrenCount,
  onAdd,
  onEdit,
  onRemove,
  onViewCategory,
}: Props) {
  const { t, monthNames } = useI18n();

  const sorted = [...items].sort((a, b) => budgetPercent(b) - budgetPercent(a));

  return (
    <Card className="overflow-hidden border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-lg font-semibold">{t('budgets.categories.title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('budgets.categories.blurb')}</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          {t('budgets.addCategoryBudget')}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-[34px] w-[34px] rounded-md" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-1.5 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <p className="text-sm font-medium">
            {t('budgets.noTitle', { month: monthNames[month - 1], year })}
          </p>
          <p className="max-w-sm text-xs text-dim">{t('budgets.noDesc')}</p>
          <Button size="sm" className="mt-1 gap-1.5" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            {t('budgets.addCategoryBudget')}
          </Button>
        </div>
      ) : (
        <>
          {/* Column headings (desktop) */}
          <div
            className={cn(
              'hidden border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim lg:grid lg:grid-cols-[minmax(0,2fr)_0.9fr_0.9fr_1.5fr_1fr_2.5rem] lg:gap-4',
            )}
          >
            <span>{t('budgets.table.category')}</span>
            <span className="text-right">{t('budgets.table.spent')}</span>
            <span className="text-right">{t('budgets.table.limit')}</span>
            <span>{t('budgets.table.progress')}</span>
            <span className="text-right">{t('budgets.remaining')}</span>
            <span />
          </div>

          <ul className="divide-y divide-border/60">
            {sorted.map((item) => (
              <BudgetRow
                key={item.budget.id}
                item={item}
                childrenCount={childrenCount}
                onEdit={onEdit}
                onRemove={onRemove}
                onViewCategory={onViewCategory}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** A single category budget row: category, spent, limit, progress, remaining. */
function BudgetRow({
  item,
  childrenCount,
  onEdit,
  onRemove,
  onViewCategory,
}: {
  item: BudgetSummaryItem;
  childrenCount: Map<string, number>;
  onEdit: (item: BudgetSummaryItem) => void;
  onRemove: (item: BudgetSummaryItem) => void;
  onViewCategory: (name: string) => void;
}) {
  const { t, formatMoney } = useI18n();

  const pct = budgetPercent(item);
  const health = budgetHealth(pct);
  const remaining = budgetRemaining(item);
  const categoryId = item.budget.category_id ?? undefined;
  const subcategories = categoryId ? childrenCount.get(categoryId) ?? 0 : 0;
  const categoryName = item.budget.category_name ?? t('common.uncategorised');

  return (
    <li className="transition-colors hover:bg-primary/[0.045]">
      <div className={cn('flex flex-col gap-2.5 px-4 py-3', ROW_COLUMNS)}>
        {/* Category */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md text-base"
            style={{ backgroundColor: `${item.budget.color ?? '#60a5fa'}1f` }}
          >
            <CategoryIcon
              name={item.budget.icon}
              className="h-[18px] w-[18px]"
              style={{ color: item.budget.color ?? '#60a5fa' }}
            />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{categoryName}</span>
            {subcategories > 0 && (
              <span className="block truncate text-xs text-dim">
                {t(
                  subcategories === 1
                    ? 'budgets.coversSubcategories_one'
                    : 'budgets.coversSubcategories_other',
                  { count: subcategories },
                )}
              </span>
            )}
          </span>
        </div>

        {/* Spent */}
        <div className="flex items-center justify-between text-sm lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('budgets.table.spent')}</span>
          <span className="font-medium tabular-nums">{formatMoney(item.actual_spent)}</span>
        </div>

        {/* Limit */}
        <div className="flex items-center justify-between text-sm lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('budgets.table.limit')}</span>
          <span className="font-medium tabular-nums text-muted-foreground">
            {formatMoney(item.budget.amount_limit)}
          </span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2">
          <Progress
            value={Math.min(pct, 100)}
            className="h-1.5 flex-1"
            indicatorClassName={HEALTH_BAR[health]}
          />
          <span
            className={cn(
              'w-12 shrink-0 text-right text-xs font-semibold tabular-nums',
              HEALTH_TEXT[health],
            )}
          >
            {pct}%
          </span>
        </div>

        {/* Remaining */}
        <div className="flex items-center justify-between text-sm lg:block lg:text-right">
          <span className="text-xs text-dim lg:hidden">{t('budgets.remaining')}</span>
          <span
            className={cn(
              'font-semibold tabular-nums',
              remaining < 0 ? 'text-danger' : 'text-foreground',
            )}
          >
            {formatMoney(remaining)}
          </span>
        </div>

        {/* Actions */}
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label={t('budgets.table.actions')}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(item)}>
                <Pencil className="h-4 w-4" />
                {t('budgets.action.edit')}
              </DropdownMenuItem>
              {item.budget.category_name && (
                <DropdownMenuItem onClick={() => onViewCategory(categoryName)}>
                  <Eye className="h-4 w-4" />
                  {t('budgets.action.viewCategory')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onRemove(item)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                {t('budgets.action.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

