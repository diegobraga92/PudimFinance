import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { cn } from '@/lib/utils';
import { priceChange } from './receipt-helpers';

/** Green for a drop, red for a rise — cheaper is good when you buy it again. */
const TONES = {
  up: 'bg-danger/10 text-danger',
  down: 'bg-success/10 text-success',
  flat: 'bg-muted text-muted-foreground',
} as const;

interface Props {
  /** Change percentage as returned by the API (or null when unknown). */
  value: string | number | null | undefined;
  /** Text shown when a change cannot be computed (e.g. a single record). */
  fallback?: string;
  className?: string;
}

/** `↓ 11%` / `↑ 9%` / `—` pill for a price change. */
export function PriceChangeBadge({ value, fallback, className }: Props) {
  const { t } = useI18n();
  const change = priceChange(value);

  if (!change) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-dim', className)}>
        {fallback ?? t('receipts.changeUnavailable')}
      </span>
    );
  }

  const Icon =
    change.direction === 'up' ? TrendingUp : change.direction === 'down' ? TrendingDown : Minus;
  const pct = Math.abs(change.percentage);
  const label =
    change.direction === 'flat'
      ? t('receipts.changeFlat')
      : `${change.direction === 'up' ? '↑' : '↓'} ${pct.toLocaleString('pt-BR', {
          maximumFractionDigits: 1,
        })}%`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        TONES[change.direction],
        className,
      )}
      title={`${t('receipts.changeLabel')}: ${label}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
