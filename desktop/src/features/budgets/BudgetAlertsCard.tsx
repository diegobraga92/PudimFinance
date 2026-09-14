import { BellRing, ChevronRight, CircleCheck } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { BudgetAlert, BudgetSummaryItem } from '@/lib/api';
import { budgetHealth, budgetPercent } from './budget-health';

interface Props {
  alerts: BudgetAlert[];
  /** The month's category budgets, used to resolve each alert's percentage. */
  items: BudgetSummaryItem[];
  loading: boolean;
  acknowledging: boolean;
  /** Alerts beyond the inline preview are hidden until expanded. */
  showingAll: boolean;
  onToggleAll: () => void;
  onAcknowledge: (id: string) => void;
  onAcknowledgeAll: () => void;
}

/** Alerts shown before the list is collapsed behind "View all". */
export const ALERT_PREVIEW_COUNT = 2;

/**
 * Threshold crossings raised by the backend, coloured by severity.
 *
 * The alert rows link back to the budget that produced them, so the percentage
 * and the over-limit amount come from real data instead of being re-derived.
 */
export function BudgetAlertsCard({
  alerts,
  items,
  loading,
  acknowledging,
  showingAll,
  onToggleAll,
  onAcknowledge,
  onAcknowledgeAll,
}: Props) {
  const { t, formatMoney } = useI18n();

  const byBudgetId = new Map(items.map((item) => [item.budget.id, item]));
  const visible = showingAll ? alerts : alerts.slice(0, ALERT_PREVIEW_COUNT);
  const hidden = alerts.length - visible.length;

  return (
    <Card className="flex h-full flex-col border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
        <h2 className="text-lg font-semibold">{t('budgets.alertsCardTitle')}</h2>
        <div className="flex items-center gap-2">
          {alerts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              disabled={acknowledging}
              onClick={onAcknowledgeAll}
            >
              {t('budgets.acknowledgeAll')}
            </Button>
          )}
          {alerts.length > ALERT_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={onToggleAll}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {showingAll ? t('budgets.alertsShowLess') : t('budgets.alertsViewAll')}
              <ChevronRight className={cn('h-3.5 w-3.5', showingAll && 'rotate-90')} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-5 pb-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-[12px]" />
            <Skeleton className="h-16 w-full rounded-[12px]" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex h-[132px] flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success/15 text-success">
              <CircleCheck className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">{t('budgets.alertsEmpty')}</p>
            <p className="max-w-[15rem] text-xs text-dim">{t('budgets.alertsEmptyDesc')}</p>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {visible.map((alert) => {
                const budget = byBudgetId.get(alert.budget_id);
                const pct = budget ? budgetPercent(budget) : null;
                const health = pct === null ? 'near' : budgetHealth(pct);
                const remaining = budget ? Number.parseFloat(budget.remaining) : 0;
                const over = remaining < 0 ? Math.abs(remaining) : null;

                return (
                  <li
                    key={alert.id}
                    className={cn(
                      'flex items-start gap-3 rounded-[12px] border px-3 py-2.5',
                      health === 'over'
                        ? 'border-danger/30 bg-danger/10 text-danger'
                        : 'border-warning/30 bg-warning/10 text-warning',
                    )}
                  >
                    <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {alert.category_name ?? t('common.uncategorised')}
                      </p>
                      <p className="mt-0.5 text-xs opacity-90">
                        {over !== null
                          ? t('budgets.alertOverMessage', {
                              amount: formatMoney(over),
                              pct: pct ?? 0,
                            })
                          : t('budgets.alertNearMessage', {
                              pct: pct ?? Math.round(Number.parseFloat(alert.threshold)),
                              spent: formatMoney(alert.actual_spent ?? '0'),
                              limit: budget ? formatMoney(budget.budget.amount_limit) : '—',
                            })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs text-current"
                      disabled={acknowledging}
                      onClick={() => onAcknowledge(alert.id)}
                    >
                      {t('budgets.acknowledge')}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={onToggleAll}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                {t('budgets.alertsMore', { count: hidden })}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
