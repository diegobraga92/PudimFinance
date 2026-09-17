import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { CategoryDonut } from '@/components/CategoryDonut';
import type { CategorySummary } from '@/lib/api';
import { reportsLink } from '@/lib/links';
import { linkHitClass } from '@/lib/interactive';

interface CategoryBreakdownCardProps {
  items: CategorySummary[];
  total: number;
  loading: boolean;
}

/** Dashboard: where this month's money went. */
export function CategoryBreakdownCard({ items, total, loading }: CategoryBreakdownCardProps) {
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
        if (key !== 'uncategorised') navigate(reportsLink({ tab: 'breakdown', categoryId: key }));
      }}
      action={
        <Link
          to="/reports"
          className={`${linkHitClass} inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline`}
        >
          {t('dashboard.viewReport')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    />
  );
}
