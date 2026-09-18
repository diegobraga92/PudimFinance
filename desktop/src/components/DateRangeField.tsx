import * as React from 'react';
import { CalendarRange, ChevronDown } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { DateField } from '@/components/DateField';
import { Button } from '@/components/ui/button';
import { toIsoDate } from '@/lib/date-input';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@shared/i18n';

export interface DateRange {
  /** Inclusive ISO `YYYY-MM-DD`, empty when the bound is open. */
  startDate: string;
  endDate: string;
}

interface DateRangeFieldProps {
  startDate: string;
  endDate: string;
  onChange: (range: DateRange) => void;
  className?: string;
}

interface Preset {
  labelKey: TranslationKey;
  range: DateRange;
}

/** This month / last month / last 30 days / this year. */
function presetRanges(): Preset[] {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const last30Start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  const todayIso = toIsoDate(today);
  return [
    {
      labelKey: 'transactions.presetThisMonth',
      range: { startDate: toIsoDate(firstOfMonth), endDate: todayIso },
    },
    {
      labelKey: 'transactions.presetLastMonth',
      range: { startDate: toIsoDate(lastMonthStart), endDate: toIsoDate(lastMonthEnd) },
    },
    {
      labelKey: 'transactions.presetLast30',
      range: { startDate: toIsoDate(last30Start), endDate: todayIso },
    },
    {
      labelKey: 'transactions.presetThisYear',
      range: { startDate: `${today.getFullYear()}-01-01`, endDate: todayIso },
    },
  ];
}

/** Date-range input with a labelled calendar popover. */
export function DateRangeField({
  startDate,
  endDate,
  onChange,
  className,
}: DateRangeFieldProps) {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const presets = React.useMemo(() => presetRanges(), []);
  const active = Boolean(startDate || endDate);

  // Clicking anywhere outside the control closes the popover.
  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const label =
    startDate && endDate
      ? `${formatDate(startDate)} – ${formatDate(endDate)}`
      : startDate
        ? t('transactions.dateRangeFrom', { date: formatDate(startDate) })
        : endDate
          ? t('transactions.dateRangeTo', { date: formatDate(endDate) })
          : t('transactions.dateRangeAny');

  return (
    <div
      ref={wrapperRef}
      className={cn('relative', className)}
      onKeyDown={(event) => {
        // Already handled by the open calendar, or by the dialog layer.
        if (event.defaultPrevented) return;
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-label={t('transactions.dateRange')}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm shadow-sm transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9',
          active ? 'border-primary/60 text-foreground' : 'text-muted-foreground',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarRange className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[18.5rem] rounded-md border border-border bg-surface p-3 shadow-popover">
          <div className="space-y-2.5">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('transactions.filters.from')}
              </p>
              <DateField
                value={startDate}
                onChange={(iso) => onChange({ startDate: iso, endDate })}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('transactions.filters.to')}
              </p>
              <DateField value={endDate} onChange={(iso) => onChange({ startDate, endDate: iso })} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
            {presets.map((preset) => (
              <button
                key={preset.labelKey}
                type="button"
                onClick={() => {
                  onChange(preset.range);
                  setOpen(false);
                }}
                className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {t(preset.labelKey)}
              </button>
            ))}
          </div>

          {active && (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ startDate: '', endDate: '' })}
              >
                {t('transactions.dateRangeClear')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
