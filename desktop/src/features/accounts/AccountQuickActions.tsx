import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, CreditCard, Plus, TrendingUp } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { transactionsLink } from '@/lib/links';

interface Props {
  onNewAccount: () => void;
  onNewInvestment: () => void;
  onTransfer: () => void;
  /** Transfer needs two balance-sheet accounts to exist. */
  canTransfer: boolean;
  /** The "pay card" shortcut only makes sense when a card exists. */
  hasCards: boolean;
  onPayCard: () => void;
}

/**
 * Shortcuts into real flows: the account form, the ledger-backed transfer
 * dialog, the card-payment workspace and transactions.
 */
export function AccountQuickActions({
  onNewAccount,
  onNewInvestment,
  onTransfer,
  canTransfer,
  hasCards,
  onPayCard,
}: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const tiles = [
    {
      key: 'new',
      icon: Plus,
      label: t('accounts.newAccount'),
      tone: 'bg-success/15 text-success ring-success/30 hover:bg-success/25',
      disabled: false,
      onClick: onNewAccount,
    },
    {
      key: 'investment',
      icon: TrendingUp,
      label: t('accounts.newInvestment'),
      tone: 'bg-success/15 text-success ring-success/30 hover:bg-success/25',
      disabled: false,
      onClick: onNewInvestment,
    },
    {
      key: 'transfer',
      icon: ArrowLeftRight,
      label: t('accounts.transfer'),
      tone: 'bg-info/15 text-info ring-info/30 hover:bg-info/25',
      disabled: !canTransfer,
      title: canTransfer ? undefined : t('accounts.transfer.needTwo'),
      onClick: onTransfer,
    },
    ...(hasCards
      ? [
          {
            key: 'pay-card',
            icon: CreditCard,
            label: t('creditCards.payBill'),
            tone: 'bg-purple/15 text-purple ring-purple/30 hover:bg-purple/25',
            disabled: false,
            onClick: onPayCard,
          },
        ]
      : []),
    {
      key: 'transactions',
      icon: ArrowLeftRight,
      label: t('nav.transactions'),
      tone: 'bg-primary/15 text-primary ring-primary/30 hover:bg-primary/25',
      disabled: false,
      onClick: () => navigate(transactionsLink()),
    },
  ];

  return (
    <Card className="border-border bg-surface shadow-card">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="text-lg font-semibold">{t('dashboard.quickActions')}</CardTitle>
      </CardHeader>
      {/* Compact tiles: two across in the sidebar, four across when the column
       * is full width, so wide screens never stretch them. */}
      <CardContent className="grid grid-cols-2 gap-2.5 p-5 pt-0 sm:grid-cols-4 xl:grid-cols-2">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={tile.onClick}
            disabled={tile.disabled}
            title={tile.title}
            className={cn(
              'flex min-h-[62px] flex-col items-center justify-center gap-1.5 rounded-md px-2 py-2 text-center text-xs font-medium ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              tile.tone,
            )}
          >
            <tile.icon className="h-4 w-4" />
            <span className="text-balance leading-tight">{tile.label}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
