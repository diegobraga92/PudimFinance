import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CategoriesTab } from '@/features/categories/CategoriesTab';
import { cn } from '@/lib/utils';
import { BudgetsTab, type BudgetFormRequest } from './BudgetsTab';

type TabKey = 'budgets' | 'categories';

/** Shift a `{ year, month }` pair by `delta` months (month is 1-12). */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let m = month + delta;
  let y = year;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

/**
 * Budgets & Categories: one screen for planning spending and for organising the
 * categories behind it.
 *
 * The month selector drives the Budgets tab (budgets are monthly); the
 * Categories tab is period-independent, so the selector is hidden there. The
 * active tab lives in the URL (`?tab=categories`) so both tabs are linkable —
 * the old `/categories` route redirects here.
 */
export function BudgetsCategoriesPage() {
  const { t, monthNames } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab: TabKey = searchParams.get('tab') === 'categories' ? 'categories' : 'budgets';
  const now = React.useMemo(() => new Date(), []);

  // The dashboard deep-links here with ?month=&year= (and &add=1 for "New
  // budget"), so the selection starts from the URL when it carries a valid
  // period and falls back to the current month.
  const initialPeriod = React.useMemo(() => {
    const yearParam = Number.parseInt(searchParams.get('year') ?? '', 10);
    const monthParam = Number.parseInt(searchParams.get('month') ?? '', 10);
    return {
      year: Number.isFinite(yearParam) && yearParam > 2000 && yearParam < 2100 ? yearParam : now.getFullYear(),
      month: Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : now.getMonth() + 1,
    };
    // Intentionally read once: later changes come from the month controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [year, setYear] = React.useState(initialPeriod.year);
  const [month, setMonth] = React.useState(initialPeriod.month);
  const [categorySearch, setCategorySearch] = React.useState(() => searchParams.get('category') ?? '');
  const [formRequest, setFormRequest] = React.useState<BudgetFormRequest | null>(null);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const monthLabel = `${monthNames[month - 1]} ${year}`;

  const shift = (delta: number) => {
    const next = shiftMonth(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
    const params = new URLSearchParams(searchParams);
    params.set('month', String(next.month));
    params.set('year', String(next.year));
    setSearchParams(params, { replace: true });
  };

  const goToTab = (next: TabKey, search?: string) => {
    setCategorySearch(search ?? '');
    const params = new URLSearchParams(searchParams);
    if (next === 'categories') {
      params.set('tab', 'categories');
      if (search) params.set('category', search);
      else params.delete('category');
    } else {
      params.delete('tab');
      params.delete('category');
    }
    setSearchParams(params, { replace: true });
  };

  // "New budget" from the dashboard: open the form once, then drop the flag.
  const addRequested = searchParams.get('add') === '1';
  React.useEffect(() => {
    if (!addRequested) return;
    const params = new URLSearchParams(searchParams);
    params.delete('add');
    setSearchParams(params, { replace: true });
    if (tab === 'budgets') setFormRequest({ mode: 'category' });
    // `searchParams` is read for its current value only; re-running on its
    // identity would loop because this effect rewrites it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequested, tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-md:hidden">
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">
            {t('budgets.pageTitle')}
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">{t('budgets.pageSubtitle')}</p>
        </div>

        {tab === 'budgets' && (
          <div className="flex w-full shrink-0 items-center justify-between gap-0.5 rounded-md border border-border bg-surface p-1 md:w-auto md:justify-start">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-8 md:w-8"
              onClick={() => shift(-1)}
              aria-label={t('dashboard.prevMonth')}
              title={t('dashboard.prevMonth')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center gap-2 whitespace-nowrap px-3 py-1.5 text-sm font-semibold">
              <CalendarDays className="h-4 w-4 text-primary" />
              {monthLabel}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-8 md:w-8"
              onClick={() => shift(1)}
              disabled={isCurrentMonth}
              aria-label={t('dashboard.nextMonth')}
              title={t('dashboard.nextMonth')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md bg-muted p-1" role="tablist">
          {(['budgets', 'categories'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => goToTab(key)}
              className={cn(
                'rounded-sm px-3.5 py-1.5 text-sm font-medium transition-colors',
                tab === key
                  ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(key === 'budgets' ? 'nav.budgets' : 'nav.categories')}
            </button>
          ))}
        </div>

        {tab === 'budgets' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" />
                {t('budgets.addBudget')}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setFormRequest({ mode: 'category' })}>
                {t('budgets.addCategoryBudget')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFormRequest({ mode: 'overall' })}>
                {t('budgets.setOverallBudget')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {tab === 'budgets' ? (
        <BudgetsTab
          year={year}
          month={month}
          monthLabel={monthLabel}
          formRequest={formRequest}
          onFormHandled={() => setFormRequest(null)}
          onViewCategory={(name) => goToTab('categories', name)}
        />
      ) : (
        <CategoriesTab initialSearch={categorySearch} />
      )}
    </div>
  );
}
