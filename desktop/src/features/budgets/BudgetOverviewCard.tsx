import { useI18n } from '@/app/i18n';
import { CategoryDonut } from '@/components/CategoryDonut';
import type { CategorySummary } from '@/lib/api';

interface Props {
  items: CategorySummary[];
  total: number;
  loading: boolean;
}

/** Budgets sidebar: how this month's spending is distributed. */
export function BudgetOverviewCard({ items, total, loading }: Props) {
  const { t } = useI18n();

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
    />
  );
}
