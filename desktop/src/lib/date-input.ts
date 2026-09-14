/**
 * Date helpers for the in-app `<DateField>`.
 *
 * Kept free of React so they can be exercised by the smoke script: the field
 * accepts dates typed in the active locale (`22/11/2026` for pt-BR,
 * `11/22/2026` for en-US), `D-M-Y` variants and ISO `YYYY-MM-DD`, and always
 * hands the API an ISO date.
 */

/** Field order of the locale's numeric date (pt-BR `d/m/y`, en-US `m/d/y`). */
export interface DateOrder {
  fields: ('d' | 'm' | 'y')[];
  separator: string;
}

export const DAYS_PER_WEEK = 7;

/** Parse the API's `YYYY-MM-DD` into a local-noon Date (DST-safe). */
export function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Build a date only when the numbers form a real calendar day. */
export function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(year, month, 0).getDate()) return null;
  return new Date(year, month - 1, day, 12);
}

/** Derive the locale's date order and separator from `Intl`. */
export function dateOrder(intl: string): DateOrder {
  const parts = new Intl.DateTimeFormat(intl, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(2026, 10, 22));
  const fields: ('d' | 'm' | 'y')[] = [];
  let separator = '/';
  for (const part of parts) {
    if (part.type === 'day') fields.push('d');
    else if (part.type === 'month') fields.push('m');
    else if (part.type === 'year') fields.push('y');
    else if (part.type === 'literal' && part.value.trim()) separator = part.value.trim();
  }
  return { fields, separator };
}

/** Render a date the way the locale writes numbers (`22/11/2026`). */
export function displayDate(date: Date | null, intl: string): string {
  if (!date) return '';
  return date.toLocaleDateString(intl, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Turn what the user typed into an ISO date, or `null` when it is not a real
 * day. Two-digit years are read as 2000s.
 */
export function parseTypedDate(text: string, order: DateOrder): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    const date = buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? toIsoDate(date) : null;
  }

  const numbers = trimmed.split(/\D+/).filter(Boolean).map(Number);
  if (numbers.length !== 3 || numbers.some(Number.isNaN)) return null;
  const byField: Record<'d' | 'm' | 'y', number> = { d: 0, m: 0, y: 0 };
  order.fields.forEach((field, index) => {
    byField[field] = numbers[index];
  });
  const year = byField.y < 100 ? byField.y + 2000 : byField.y;
  const date = buildDate(year, byField.m, byField.d);
  return date ? toIsoDate(date) : null;
}

/** The month's days padded with `null` so the grid always starts on Sunday. */
export function monthCells(year: number, month: number): (Date | null)[] {
  const cells: (Date | null)[] = [];
  const lead = new Date(year, month - 1, 1, 12).getDay();
  for (let i = 0; i < lead; i += 1) cells.push(null);
  const total = new Date(year, month, 0).getDate();
  for (let day = 1; day <= total; day += 1) cells.push(new Date(year, month - 1, day, 12));
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);
  return cells;
}

/** Placeholder for the typed input, e.g. `dd/mm/aaaa` or `mm/dd/yyyy`. */
export function datePlaceholder(order: DateOrder, locale: string): string {
  const token = { d: 'dd', m: 'mm', y: locale === 'pt-BR' ? 'aaaa' : 'yyyy' } as const;
  return order.fields.map((field) => token[field]).join(order.separator);
}

/** Short weekday labels starting on Sunday, for the calendar header. */
export function weekdayLabels(intl: string): string[] {
  const format = new Intl.DateTimeFormat(intl, { weekday: 'short' });
  // 2026-01-04 is a Sunday, so this walks one full week from Sunday.
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    format.format(new Date(2026, 0, 4 + index)).replace('.', ''),
  );
}
