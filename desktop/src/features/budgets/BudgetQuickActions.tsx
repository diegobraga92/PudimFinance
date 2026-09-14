import { useNavigate } from 'react-router-dom';
import { Plus, Tags, TrendingUp, Target } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  hasOverall: boolean;
  onAddCategoryBudget: () => void;
  onSetOverall: () => void;
  onManageCategories: () => void;
}

/** Shortcuts into the flows this screen needs (all of them real). */
export function BudgetQuickActions({
  hasOverall,
  onAddCategoryBudget,
  onSetOverall,
  onManageCategories,
}: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const tiles = [
    {
      key: 'add',
      icon: Plus,
      label: t('budgets.addCategoryBudget'),
      tone: 'bg-success/15 text-success ring-success/30 hover:bg-success/25',
      onClick: onAddCategoryBudget,
    },
    {
      key: 'overall',
      icon: Target,
      label: hasOverall ? t('budgets.action.editOverall') : t('budgets.setOverallBudget'),
      tone: 'bg-purple/15 text-purple ring-purple/30 hover:bg-purple/25',
      onClick: onSetOverall,
    },
    {
      key: 'categories',
      icon: Tags,
      label: t('budgets.actions.manageCategories'),
      tone: 'bg-info/15 text-info ring-info/30 hover:bg-info/25',
      onClick: onManageCategories,
    },
    {
      key: 'reports',
      icon: TrendingUp,
      label: t('nav.reports'),
      tone: 'bg-primary/15 text-primary ring-primary/30 hover:bg-primary/25',
      onClick: () => navigate('/reports'),
    },
  ];

  return (
    <Card className="border-border bg-surface shadow-card">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="text-lg font-semibold">{t('dashboard.quickActions')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 p-5 pt-0">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={tile.onClick}
            className={cn(
              'flex min-h-[72px] flex-col justify-center gap-2 rounded-md px-3.5 py-3 text-left text-sm font-medium ring-1 ring-inset transition-colors',
              tile.tone,
            )}
          >
            <tile.icon className="h-4 w-4" />
            <span className="leading-tight">{tile.label}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
