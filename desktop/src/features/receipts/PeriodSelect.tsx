import type { StorePeriod } from '@/lib/api';
import { useI18n } from '@/app/i18n';
import { PERIOD_LABEL_KEY, STORE_PERIODS } from './receipt-helpers';

interface Props {
  value: StorePeriod;
  onChange: (period: StorePeriod) => void;
  className?: string;
}

/** Period filter shared by the stores list and the overview top-stores card. */
export function PeriodSelect({ value, onChange, className }: Props) {
  const { t } = useI18n();
  return (
    <select
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value as StorePeriod)}
      aria-label={t('receipts.periodLabel')}
    >
      {STORE_PERIODS.map((option) => (
        <option key={option} value={option}>
          {t(PERIOD_LABEL_KEY[option])}
        </option>
      ))}
    </select>
  );
}
