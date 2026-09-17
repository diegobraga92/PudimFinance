import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DashboardHeaderProps {
  year: number;
  month: number;
  /** `true` when the selected period is the current month (forward nav disabled). */
  isCurrentMonth: boolean;
  greeting: string;
  onPrev: () => void;
  onNext: () => void;
  onCurrentMonth: () => void;
}

/** Greeting + the month switcher that every dashboard card follows. */
export function DashboardHeader({
  year,
  month,
  isCurrentMonth,
  greeting,
  onPrev,
  onNext,
  onCurrentMonth,
}: DashboardHeaderProps) {
  const { t, monthNames } = useI18n();
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-tight tracking-[-0.01em] md:text-[28px] md:tracking-[-0.02em]">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground md:mt-1.5 md:text-base">
          {t('dashboard.overviewSubtitle', { month: monthNames[month - 1], year })}
        </p>
      </div>

      <div className="flex w-full shrink-0 items-center justify-between gap-0.5 rounded-md border border-border bg-surface p-1 md:w-auto md:justify-start">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 touch-manipulation active:scale-95 md:h-8 md:w-8"
          onClick={onPrev}
          aria-label={t('dashboard.prevMonth')}
          title={t('dashboard.prevMonth')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <button
          type="button"
          onClick={onCurrentMonth}
          disabled={isCurrentMonth}
          title={t('dashboard.thisMonth')}
          className={cn(
            'flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors',
            isCurrentMonth ? 'cursor-default' : 'touch-manipulation hover:bg-surface-hover active:bg-surface-hover',
          )}
        >
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="whitespace-nowrap">
            {monthNames[month - 1]} {year}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 touch-manipulation active:scale-95 md:h-8 md:w-8"
          onClick={onNext}
          disabled={isCurrentMonth}
          aria-label={t('dashboard.nextMonth')}
          title={t('dashboard.nextMonth')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
