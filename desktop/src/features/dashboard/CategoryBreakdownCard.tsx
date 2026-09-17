import { Link, useNavigate } from 'react-router-dom';

import { useI18n } from '@/app/i18n';
import { CategoryDonut } from '@/components/CategoryDonut';
import type { CategorySummary } from '@/lib/api';
import { transactionsLink } from '@/lib/links';
import { linkHitClass } from '@/lib/interactive';

interface CategoryBreakdownCardProps {
  items: CategorySummary[];
  total: number;
  loading: boolean;
  startDate: string;
  endDate: string;
}

/** Dashboard: where this month's money went. */
export function CategoryBreakdownCard({ items, total, loading, startDate, endDate }: CategoryBreakdownCardProps) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const donutItems = items.map((item) => ({
    key: item.category_id ?? 'uncategorised',
    name: item.category_name ?? t('common.uncategorised'),
    icon: item.icon,
    color: item.color,
    amount: Number.parseFloat(item.total) || 0,
  }));

  return (
    <CategoryDonut
      items={donutItems}
      total={total}
      loading={loading}
      title={t('dashboard.expensesByCategory')}
      centerLabel={t('common.total')}
      emptyTitle={t('reports.noExpensesMonth')}
      onSelect={(key) => {
        if (key !== 'uncategorised') {
          navigate(
            transactionsLink({
              categoryId: key,
              type: 'expense',
              startDate,
              endDate,
            }),
          );
        }
      }}
      action={
        <Link
          to={transactionsLink({ type: 'expense', startDate, endDate })}
          className={`${linkHitClass} inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline`}
        >
          {t('dashboard.viewAll')}
        </Link>
      }
    />
  );
}
