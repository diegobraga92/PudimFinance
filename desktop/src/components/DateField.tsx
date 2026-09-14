import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Input } from '@/components/ui/input';
import {
  dateOrder,
  datePlaceholder,
  displayDate,
  monthCells,
  parseIsoDate,
  parseTypedDate,
  toIsoDate,
  weekdayLabels,
} from '@/lib/date-input';
import { toIntlLocale } from '@shared/i18n';
import { cn } from '@/lib/utils';

interface DateFieldProps {
  id?: string;
  /** Selected date as an ISO `YYYY-MM-DD` string (the API's wire format). */
  value: string;
  onChange: (isoDate: string) => void;
  /** Extra classes forwarded to the text input. */
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * Date input that never opens the WebView's native picker.
 *
 * Native `<input type="date">` popups cannot be dismissed by clicking away (and
 * swallow typing) inside a modal on some WebViews — notably WebKitGTK, which
 * Tauri uses on Linux. This field keeps a plain, typeable input and renders its
 * own calendar, so Enter commits, clicking outside closes the calendar, and
 * Escape closes only the calendar instead of the whole dialog.
 */
export function DateField({
  id,
  value,
  onChange,
  className,
  ariaLabel,
  autoFocus,
  disabled,
}: DateFieldProps) {
  const { t, locale } = useI18n();
  const intl = toIntlLocale(locale);
  const order = React.useMemo(() => dateOrder(intl), [intl]);

  const selected = parseIsoDate(value);
  const todayIso = toIsoDate(new Date());

  const [text, setText] = React.useState(() => displayDate(parseIsoDate(value), intl));
  const [open, setOpen] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const [view, setView] = React.useState(() => {
    const base = parseIsoDate(value) ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() + 1 };
  });

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Follow the external value (form reset, "today" shortcut, edit target).
  React.useEffect(() => {
    setText(displayDate(parseIsoDate(value), intl));
    setInvalid(false);
  }, [value, intl]);

  // Clicking anywhere outside the field closes the calendar.
  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // Escape closes only the calendar, not the surrounding dialog. Radix listens
  // for Escape on `document` in the capture phase, so handling it on `window`
  // (one step higher) and marking it prevented makes the dialog bail out.
  React.useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [open]);

  /** Parse what was typed, or restore the last valid value. */
  const commit = () => {
    const parsed = parseTypedDate(text, order);
    if (!parsed) {
      setInvalid(text.trim().length > 0);
      setText(displayDate(selected, intl));
      return;
    }
    const parsedDate = parseIsoDate(parsed);
    setInvalid(false);
    setText(displayDate(parsedDate, intl));
    if (parsedDate) setView({ year: parsedDate.getFullYear(), month: parsedDate.getMonth() + 1 });
    if (parsed !== value) onChange(parsed);
  };

  const selectDay = (date: Date) => {
    setInvalid(false);
    setText(displayDate(date, intl));
    setView({ year: date.getFullYear(), month: date.getMonth() + 1 });
    setOpen(false);
    if (toIsoDate(date) !== value) onChange(toIsoDate(date));
  };

  const toggleCalendar = () => {
    if (!open) {
      const base = parseIsoDate(parseTypedDate(text, order) ?? '') ?? selected ?? new Date();
      setView({ year: base.getFullYear(), month: base.getMonth() + 1 });
    }
    setOpen(!open);
  };

  const shiftView = (delta: number) => {
    setView((current) => {
      const next = new Date(current.year, current.month - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  };

  /** Enter commits what was typed instead of submitting the form. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target === inputRef.current) {
      event.preventDefault();
      commit();
    }
  };

  const cells = React.useMemo(() => monthCells(view.year, view.month), [view]);
  const weekdays = React.useMemo(() => weekdayLabels(intl), [intl]);
  const placeholder = React.useMemo(() => datePlaceholder(order, locale), [order, locale]);
  const monthLabel = new Date(view.year, view.month - 1, 1).toLocaleDateString(intl, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div ref={wrapperRef} className="relative" onKeyDown={handleKeyDown}>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          inputMode="numeric"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          className={cn(
            'pr-9',
            invalid && 'border-destructive focus-visible:ring-destructive',
            className,
          )}
        />
        <button
          type="button"
          onClick={toggleCalendar}
          aria-label={t('common.pickDate')}
          aria-expanded={open}
          disabled={disabled}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays className="h-4 w-4" />
        </button>

        {open && (
          <div className="absolute left-0 z-30 mt-1 w-[15.5rem] rounded-md border border-border bg-surface p-2.5 shadow-popover">
            <div className="flex items-center justify-between gap-1 pb-2">
              <button
                type="button"
                onClick={() => shiftView(-1)}
                aria-label={t('common.previousMonth')}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="text-sm font-semibold">{monthLabel}</p>
              <button
                type="button"
                onClick={() => shiftView(1)}
                aria-label={t('common.nextMonth')}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 justify-items-center gap-y-0.5">
              {weekdays.map((weekday, index) => (
                <span
                  key={`${weekday}-${index}`}
                  className="flex h-6 items-center justify-center text-[10px] font-medium uppercase text-dim"
                >
                  {weekday.slice(0, 2)}
                </span>
              ))}
              {cells.map((cell, index) => {
                if (!cell) return <span key={`empty-${index}`} className="h-8 w-8" />;
                const iso = toIsoDate(cell);
                const isSelected = iso === value;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => selectDay(cell)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-sm text-sm tabular-nums transition-colors hover:bg-surface-hover',
                      isSelected
                        ? 'bg-primary font-semibold text-primary-foreground hover:bg-primary'
                        : iso === todayIso && 'font-semibold ring-1 ring-inset ring-primary/50',
                    )}
                  >
                    {cell.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => selectDay(new Date())}
                className="rounded-sm px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-surface-hover"
              >
                {t('common.today')}
              </button>
            </div>
          </div>
        )}
      </div>

      {invalid && <p className="mt-1 text-xs text-destructive">{t('common.invalidDate')}</p>}
    </div>
  );
}
