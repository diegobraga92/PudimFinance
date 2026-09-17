import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/app/i18n';
import {
  fetchMonthlyReport,
  fetchTransactions,
  type AccountWithBalance,
  type CardBill,
  type Category,
  type Transaction,
} from '@/lib/api';
import { isCreditCard } from './account-groups';
import { AccountMonthlySummary } from './AccountMonthlySummary';
import { AccountTransactionsTable } from './AccountTransactionsTable';
import { CardAccountSection } from '@/features/creditCards/CardAccountSection';
import { TransactionDetailsDialog } from '@/features/dashboard/TransactionDetailsDialog';
import { transactionsLink, monthDateRange } from '@/lib/links';

/** Number of months shown in the per-account monthly summary. */
const SUMMARY_MONTHS = 12;

/** Account data shown by the Accounts page and its type-aware detail workspace. */
interface Props {
  categories: Category[];
  open: boolean;
  onClose: () => void;
  onCardPurchase: () => void;
  onCardPay: (bill: CardBill) => void;
  onCardAnticipate: (bill: CardBill | null) => void;
  initialCardAction?: 'pay' | null;
}

export type AccountLike = AccountWithBalance;

/** Modal with account transactions, card actions, and an optional monthly summary. */
export function AccountDetail({
  account,
  categories,
  open,
  onClose,
  onCardPurchase,
  onCardPay,
  onCardAnticipate,
  initialCardAction = null,
}: Props & { account: AccountLike }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [selectedTransaction, setSelectedTransaction] = React.useState<Transaction | null>(null);

  React.useEffect(() => {
    setSummaryOpen(false);
    setSelectedTransaction(null);
  }, [account.id]);

  const now = React.useMemo(() => new Date(), []);
  const range = React.useMemo(() => {
    const start = new Date(now.getFullYear(), now.getMonth() - (SUMMARY_MONTHS - 1), 1);
    return {
      startYear: start.getFullYear(),
      startMonth: start.getMonth() + 1,
      endYear: now.getFullYear(),
      endMonth: now.getMonth() + 1,
    };
  }, [now]);

  const reportQuery = useQuery({
    queryKey: ['account-report', account.id, range],
    queryFn: () =>
      fetchMonthlyReport(
        range.startYear,
        range.startMonth,
        range.endYear,
        range.endMonth,
        account.id,
      ),
    enabled: open && summaryOpen,
  });
  const txQuery = useQuery({
    queryKey: ['account-tx', account.id],
    queryFn: () => fetchTransactions({ account_id: account.id, page_size: 200 }),
    enabled: open,
  });

  const monthsDesc = reportQuery.data ? [...reportQuery.data.months].reverse() : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto p-4 sm:max-w-4xl md:p-6">
        <DialogHeader>
          <DialogTitle>{t('accounts.detail.title', { name: account.name })}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          {isCreditCard(account) && (
            <CardAccountSection
              account={account}
              open={open}
              initialAction={initialCardAction}
              onPurchase={onCardPurchase}
              onPay={onCardPay}
              onAnticipate={onCardAnticipate}
            />
          )}

          <section className="min-w-0 space-y-2">
            <h4 className="text-sm font-semibold">{t('accounts.detail.transactions')}</h4>
            <AccountTransactionsTable
              transactions={txQuery.data?.items ?? []}
              categories={categories}
              loading={txQuery.isLoading}
              error={txQuery.error}
              onSelect={setSelectedTransaction}
            />
          </section>

          <AccountMonthlySummary
            months={monthsDesc}
            monthCount={SUMMARY_MONTHS}
            loading={reportQuery.isLoading}
            error={reportQuery.error}
            open={summaryOpen}
            onToggle={() => setSummaryOpen((value) => !value)}
            onSelectMonth={(year, month) => {
              onClose();
              navigate(transactionsLink({ accountId: account.id, ...monthDateRange(year, month) }));
            }}
          />
        </div>
      </DialogContent>
      <TransactionDetailsDialog
        transaction={selectedTransaction}
        category={selectedTransaction?.category_id ? categories.find((category) => category.id === selectedTransaction.category_id) : undefined}
        account={account}
        onOpenChange={(next) => !next && setSelectedTransaction(null)}
      />
    </Dialog>
  );
}