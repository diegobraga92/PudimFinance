import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/app/auth';
import { RootLayout } from '@/app/RootLayout';
import { LoginPage } from '@/app/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { BudgetsCategoriesPage } from '@/features/budgets/BudgetsCategoriesPage';
import { MorePage } from '@/features/more/MorePage';
import { LedgerPage } from '@/features/ledger/LedgerPage';
import { ReconciliationPage } from '@/features/reconciliation/ReconciliationPage';
import { ReceiptsPage } from '@/features/receipts/ReceiptsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { ServerPage } from '@/features/server/ServerPage';
import { NotificationSettingsPage } from '@/features/notifications/NotificationSettingsPage';
import { PendingCapturesPage } from '@/features/notifications/PendingCapturesPage';
import { OnboardingGate } from '@/features/onboarding/OnboardingGate';
import { BiometricLock } from '@/features/biometric/BiometricLock';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, restoredSession } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return (
    <BiometricLock lockOnMount={restoredSession}>{children}</BiometricLock>
  );
}

export function App() {
  return (
    <AuthGate>
      <OnboardingGate>
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/budgets" element={<BudgetsCategoriesPage />} />
            <Route path="/more" element={<MorePage />} />
            {/* Reports were consolidated into the dashboard and transactions flows. */}
            <Route path="/reports" element={<Navigate to="/transactions" replace />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/reconciliation" element={<ReconciliationPage />} />
            <Route path="/receipts" element={<ReceiptsPage />} />
            {/* Categories now live in the Budgets tab switcher. */}
            <Route path="/categories" element={<Navigate to="/budgets?tab=categories" replace />} />
            <Route path="/audit" element={<AuditPage />} />
            {/* Credit-card workflows now live in the Accounts detail dialog. */}
            <Route path="/credit-cards" element={<Navigate to="/accounts" replace />} />
            <Route path="/notifications" element={<NotificationSettingsPage />} />
            <Route path="/pending-review" element={<PendingCapturesPage />} />
            <Route path="/server" element={<ServerPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </OnboardingGate>
    </AuthGate>
  );
}
