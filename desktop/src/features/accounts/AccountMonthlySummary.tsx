import { ChevronDown } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import type { MonthlyReportItem } from '@/lib/api';
import { tapClass } from '@/lib/interactive';
import { cn } from '@/lib/utils';

interface Props {
  months: MonthlyReportItem[];
  monthCount: number;
  loading: boolean;
  error: unknown;
  open: boolean;
  onToggle: () => void;
  onSelectMonth?: (year: number, month: number) => void;
}

/** Collapsed-by-default account monthly summary, with a phone-safe layout. */
export function AccountMonthlySummary({ months, monthCount, loading, error, open, onToggle, onSelectMonth }: Props) {
  const { t, formatMoney, monthNames } = useI18n();
  const hasActivity = months.some(
    (month) => parseFloat(month.income_total) !== 0 || parseFloat(month.expense_total) !== 0,
  );

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-3 bg-primary/[0.03] px-3 py-3 text-left transition-colors hover:bg-primary/[0.06] sm:px-4',
          open && 'border-b border-border/60',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{t('accounts.detail.monthlySummary')}</span>
          <span className="block truncate text-xs text-dim">
            {t('accounts.detail.lastMonths', { count: monthCount })}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-dim transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="min-w-0 p-3 sm:p-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-8 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : t('accounts.detail.failedLoad')}
            </p>
          ) : !hasActivity ? (
            <p className="text-sm text-dim">{t('accounts.detail.noMonthlyData')}</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="hidden grid-cols-4 gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground md:grid">
                <span>{t('reports.month')}</span>
                <span className="text-right">{t('reports.income')}</span>
                <span className="text-right">{t('reports.expenses')}</span>
                <span className="text-right">{t('reports.netShort')}</span>
              </div>
              {months.map((month) => {
                const net = parseFloat(month.balance);
                return (
                  <div
                    key={`${month.year}-${month.month}`}
                    role={onSelectMonth ? 'button' : undefined}
                    tabIndex={onSelectMonth ? 0 : undefined}
                    onClick={onSelectMonth ? () => onSelectMonth(month.year, month.month) : undefined}
                    onKeyDown={onSelectMonth ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectMonth(month.year, month.month);
                      }
                    } : undefined}
                    className={cn(
                      'border-b border-border px-3 py-2.5 last:border-b-0 md:grid md:grid-cols-4 md:gap-2 md:py-2',
                      onSelectMonth && cn(
                        'cursor-pointer transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        tapClass,
                      ),
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground md:block">
                      <span>{monthNames[month.month - 1]} {month.year}</span>
                      <span
                        className={cn(
                          'font-medium tabular-nums md:hidden',
                          net >= 0 ? 'text-income' : 'text-expense',
                        )}
                      >
                        {formatMoney(net)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-dim md:mt-0 md:text-right md:text-sm md:text-income">
                      <span className="md:hidden">{t('reports.income')}: </span>
                      <span className="tabular-nums">{formatMoney(month.income_total)}</span>
                    </span>
                    <span className="block text-xs text-dim md:text-right md:text-sm md:text-expense">
                      <span className="md:hidden">{t('reports.expenses')}: </span>
                      <span className="tabular-nums">{formatMoney(month.expense_total)}</span>
                    </span>
                    <span
                      className={cn(
                        'hidden text-right font-medium tabular-nums md:block',
                        net >= 0 ? 'text-income' : 'text-expense',
                      )}
                    >
                      {formatMoney(net)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}