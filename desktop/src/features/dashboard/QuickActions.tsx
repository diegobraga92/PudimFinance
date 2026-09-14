import { Link } from 'react-router-dom';
import { FileSearch, Plus, ReceiptText, Target } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface QuickActionsProps {
  /** Deep link into the budget form, keeping the dashboard's period. */
  newBudgetLink: string;
}

/**
 * Shortcuts into real flows: the add-transaction form, receipt scanning,
 * reconciliation, and the budget editor.
 */
export function QuickActions({ newBudgetLink }: QuickActionsProps) {
  const { t } = useI18n();
  const actions = [
    {
      to: '/transactions?add=1',
      icon: Plus,
      label: t('dashboard.quickActions.addTransaction'),
      tone: 'bg-success/15 text-success ring-success/30 hover:bg-success/25',
    },
    {
      to: '/receipts',
      icon: ReceiptText,
      label: t('dashboard.quickActions.scanReceipt'),
      tone: 'bg-warning/15 text-warning ring-warning/30 hover:bg-warning/25',
    },
    {
      to: '/reconciliation',
      icon: FileSearch,
      label: t('dashboard.quickActions.reconcile'),
      tone: 'bg-primary/15 text-primary ring-primary/30 hover:bg-primary/25',
    },
    {
      to: newBudgetLink,
      icon: Target,
      label: t('dashboard.quickActions.newBudget'),
      tone: 'bg-purple/15 text-purple ring-purple/30 hover:bg-purple/25',
    },
  ];

  return (
    <Card className="border-border bg-surface shadow-card">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="text-lg font-semibold">{t('dashboard.quickActions')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 p-5 pt-0">
        {actions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className={cn(
              'flex min-h-[64px] flex-col justify-center gap-2 rounded-md px-3.5 py-3 text-sm font-medium ring-1 ring-inset transition-colors',
              action.tone,
            )}
          >
            <action.icon className="h-4 w-4" />
            <span className="leading-tight">{action.label}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
