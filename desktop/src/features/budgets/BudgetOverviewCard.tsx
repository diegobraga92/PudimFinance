import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/app/i18n';
import { CategoryDonut } from '@/components/CategoryDonut';
import type { CategorySummary } from '@/lib/api';
import { monthDateRange, transactionsLink } from '@/lib/links';

interface Props {
  items: CategorySummary[];
  total: number;
  loading: boolean;
  year: number;
  month: number;
}

/** Budgets sidebar: how this month's spending is distributed. */
export function BudgetOverviewCard({ items, total, loading, year, month }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { startDate, endDate } = monthDateRange(year, month);

  return (
    <CategoryDonut
      items={items.map((item) => ({
        key: item.category_id ?? 'uncategorised',
        name: item.category_name ?? t('common.uncategorised'),
        icon: item.icon,
        color: item.color,
        amount: Number.parseFloat(item.total) || 0,
      }))}
      total={total}
      loading={loading}
      title={t('budgets.overview.title')}
      centerLabel={t('budgets.summary.spent')}
      emptyTitle={t('budgets.overview.empty')}
      emptyHint={t('budgets.overview.emptyHint')}
      onSelect={(key) => {
        const item = items.find((candidate) => (candidate.category_id ?? 'uncategorised') === key);
        if (item?.category_id) {
          navigate(transactionsLink({
            categoryId: item.category_id,
            type: 'expense',
            startDate,
            endDate,
          }));
        }
      }}
    />
  );
}
