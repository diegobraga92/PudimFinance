/**
 * Locale-aware helpers for the money inputs.
 */

/** The locale's decimal separator: `,` for pt-BR, `.` for en-US. */
export function decimalSeparator(intl: string): string {
  const parts = new Intl.NumberFormat(intl).formatToParts(1.1);
  return parts.find((part) => part.type === 'decimal')?.value ?? '.';
}

/**
 * Placeholder hint written in the locale's convention, e.g. `0,00` / `0.00`
 * (or `500,00` / `500.00` when a sample value is given).
 */
export function moneyPlaceholder(intl: string, sample: string | number = 0): string {
  const separator = decimalSeparator(intl);
  const raw = typeof sample === 'number' ? sample.toFixed(2) : String(sample);
  const [whole, fraction = ''] = raw.replace(',', '.').split('.');
  const cents = `${fraction}00`.slice(0, 2);
  return `${whole || '0'}${separator}${cents}`;
}

/**
 * Convert a canonical wire decimal (`"1234.56"`) into the field's display form
 * (`"1234,56"` in pt-BR). No thousands grouping is added, so the value stays
 * unambiguous for the `.replace(',', '.')` normalization used on submit.
 */
export function toAmountInput(canonical: string, intl: string): string {
  const trimmed = String(canonical ?? '').trim();
  if (!trimmed) return '';
  const separator = decimalSeparator(intl);
  if (separator === '.') return trimmed;
  return trimmed.replace('.', separator);
}
