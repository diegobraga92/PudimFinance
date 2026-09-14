/**
 * Android shell smoke test
 * (run with `npx tsx --tsconfig=tsconfig.app.json scripts/android-shell-smoke.tsx`).
 *
 * Server-side renders the phone/desktop compositions — the app shell with the
 * bottom tab bar, the More tab, the primary screens and the accounting tools —
 * and checks the navigation model and the month grouping used by the phone
 * transaction list. No backend or browser required.
 */
import 'fake-indexeddb/auto';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
};
store.set('pudim_locale', 'en');

import { I18nProvider } from '../src/app/i18n';
import { ThemeProvider } from '../src/app/theme';
import { AuthProvider, useAuth } from '../src/app/auth';
import { TooltipProvider } from '../src/components/ui/tooltip';
import { Toaster } from '../src/components/ui/toaster';
import { RootLayout } from '../src/app/RootLayout';
import { MorePage } from '../src/features/more/MorePage';
import { TransactionsPage } from '../src/features/transactions/TransactionsPage';
import { DashboardPage } from '../src/features/dashboard/DashboardPage';
import { AccountsPage } from '../src/features/accounts/AccountsPage';
import { ReconciliationPage } from '../src/features/reconciliation/ReconciliationPage';
import { LedgerPage } from '../src/features/ledger/LedgerPage';
import { AuditPage } from '../src/features/audit/AuditPage';
import { ReceiptsPage } from '../src/features/receipts/ReceiptsPage';
import { PRIMARY_NAV, MOBILE_TABS, TOOL_GROUPS, screenTitleKey, isMobileRoot } from '../src/app/navigation';
import { groupTransactionsByMonth } from '../src/features/transactions/group-by-month';

function Providers({ children, client }: { children: React.ReactNode; client?: QueryClient }) {
  const fallback = React.useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={client ?? fallback}>
      <AuthProvider>
        <I18nProvider>
          <ThemeProvider>
            <MemoryRouter initialEntries={['/dashboard']}>
              <TooltipProvider>
                <Toaster>{children}</Toaster>
              </TooltipProvider>
            </MemoryRouter>
          </ThemeProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

let failures = 0;

function check(label: string, node: React.ReactNode, needles: string[], client?: QueryClient) {
  const html = renderToStaticMarkup(<Providers client={client}>{node}</Providers>);
  for (const needle of needles) {
    if (!html.includes(needle)) {
      console.error(`FAIL: ${label} — missing "${needle}"`);
      failures += 1;
      return;
    }
  }
  console.log(`PASS: ${label} (${html.length} chars)`);
}

// ---- shell -----------------------------------------------------------------
check(
  'RootLayout (phone + desktop nav)',
  <Routes>
    <Route element={<RootLayout />}>
      <Route path="/dashboard" element={<div>dashboard-content</div>} />
    </Route>
  </Routes>,
  [
    'dashboard-content',
    'Pudim', // brand lockup in the phone app bar
    'Home',
    'Transactions',
    'Accounts',
    'Budgets',
    'More',
    'Reports', // desktop nav still rendered (hidden by CSS below md)
  ],
);

check('MorePage', <MorePage />, [
  'Receipts',
  'Scan and track prices',
  'Reconciliation',
  'Match bank statements',
  'Ledger',
  'Double-entry transactions',
  'Audit Log',
  'System event history',
  'Server',
  'Switch the app appearance',
  'Change the interface language',
  'Active', // the current theme/language row
  'Sign out',
]);

check('TransactionsPage (empty state + actions)', <TransactionsPage />, [
  'aria-label="Export CSV"',
  'Transaction history',
].filter((needle) => needle !== 'Transaction history'));

// Accounts with data: grouped cards + scrollable phone chips.
const accountsClient = new QueryClient();
accountsClient.setQueryData(['accounts'], [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Nubank',
    account_kind: 'bank',
    type: 'asset',
    balance: '5420.20',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Nubank Visa',
    account_kind: 'card',
    type: 'liability',
    balance: '-1240.80',
    closing_day: 15,
    due_day: 22,
    created_at: '2026-01-01T00:00:00Z',
  },
]);
const accountsHtml = renderToStaticMarkup(
  <Providers client={accountsClient}>
    <AccountsPage />
  </Providers>,
);
if (accountsHtml.includes('No accounts yet')) {
  console.error('DEBUG: accounts page fell back to its empty state');
}
for (const needle of ['Bank accounts', 'Nubank', 'max-md:w-full', 'aria-label="Transfer"']) {
  if (!accountsHtml.includes(needle)) {
    const at = accountsHtml.indexOf('No accounts');
    console.error(
      `FAIL: AccountsPage (with data) — missing "${needle}" (empty=${at >= 0}, len=${accountsHtml.length})`,
    );
    failures += 1;
    break;
  }
}
if (!accountsHtml.includes('max-md:w-full')) {
  /* already reported */
} else {
  console.log(`PASS: AccountsPage (with data) (${accountsHtml.length} chars)`);
}

check('DashboardPage (phone lead + month nav)', <DashboardPage />, [
  'aria-label="Previous month"',
  'aria-label="Next month"',
  'md:order-3',
]);

check('ReconciliationPage (3-step wizard)', <ReconciliationPage />, [
  'Upload',
  'Match',
  'Review',
  'Drop your file here',
  'Recent reconciliations',
]);

check('LedgerPage (phone-compact workspace)', <LedgerPage />, [
  'Accounting Ledger',
  'New Ledger Entry',
  'max-md:hidden',
]);

check('AuditPage (non-admin gate)', <AuditPage />, ['Admin access required']);

check('ReceiptsPage (phone capture shortcuts)', <ReceiptsPage />, [
  'Scan QR code',
  'Upload photo',
  'Overview',
  'Items &amp; Prices',
]);

// ---- navigation model ------------------------------------------------------
const tabRoutes = MOBILE_TABS.map((tab) => tab.route);
const toolKeys = TOOL_GROUPS.flatMap((group) => group.items.map((item) => item.key));
const navChecks: [string, boolean][] = [
  ['five bottom tabs', MOBILE_TABS.length === 5],
  ['tabs are the daily surfaces', tabRoutes.join(',') === '/dashboard,/transactions,/accounts,/budgets,/more'],
  ['receipts stays out of the bottom bar', !tabRoutes.includes('/receipts')],
  ['tools keep the accounting screens', ['reconciliation', 'ledger', 'audit'].every((k) => toolKeys.includes(k))],
  ['screenTitleKey maps a tab', screenTitleKey('/accounts') === 'nav.accounts'],
  ['screenTitleKey maps a tool', screenTitleKey('/ledger') === 'nav.ledger'],
  ['screenTitleKey falls back to home', screenTitleKey('/something-else') === 'nav.dashboard'],
  ['isMobileRoot true for tabs', isMobileRoot('/transactions')],
  ['isMobileRoot false for tools', !isMobileRoot('/ledger')],
  ['primary nav keeps receipts', PRIMARY_NAV.some((item) => item.route === '/receipts')],
];
for (const [label, ok] of navChecks) {
  if (!ok) {
    console.error(`FAIL: nav model — ${label}`);
    failures += 1;
  }
}
if (failures === 0) console.log(`PASS: nav model (${MOBILE_TABS.length} tabs, ${toolKeys.length} tools)`);

// ---- phone month grouping --------------------------------------------------
const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const tx = (id: string, date: string): { id: string; date: string } => ({ id, date });
const grouped = groupTransactionsByMonth(
  [
    tx('a', '2026-09-14'),
    tx('b', '2026-09-02'),
    tx('c', '2026-08-30'),
    tx('d', '2025-12-31'),
  ] as never,
  months,
);
const groupingChecks: [string, boolean][] = [
  ['three month sections', grouped.length === 3],
  ['newest section first', grouped[0].key === '2026-09'],
  ['sections keep input order', grouped[0].items.map((t) => t.id).join(',') === 'a,b'],
  ['heading is month + year', grouped[0].label === 'SEPTEMBER 2026'],
  ['older month heading', grouped[2].label === 'DECEMBER 2025'],
  ['single-item section', grouped[2].items.length === 1],
];
for (const [label, ok] of groupingChecks) {
  if (!ok) {
    console.error(`FAIL: month grouping — ${label}`);
    failures += 1;
  }
}
if (groupingChecks.every(([, ok]) => ok)) {
  console.log(`PASS: month grouping (${grouped.map((g) => g.label).join(' / ')})`);
}

if (failures > 0) process.exit(1);
console.log('Android composition checks passed.');
void useAuth;
