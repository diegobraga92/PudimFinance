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
import { NotificationCaptureProvider } from '../src/notifications/NotificationCaptureProvider';
import { RootLayout } from '../src/app/RootLayout';
import { DateField } from '../src/components/DateField';
import { DateRangeField } from '../src/components/DateRangeField';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { ErrorFallback } from '../src/components/ErrorFallback';
import { Checkbox } from '../src/components/ui/checkbox';
import {
  dateOrder,
  datePlaceholder,
  parseTypedDate,
  weekdayLabels,
} from '../src/lib/date-input';
import { MorePage } from '../src/features/more/MorePage';
import { TransactionsPage } from '../src/features/transactions/TransactionsPage';
import { DashboardPage } from '../src/features/dashboard/DashboardPage';
import { withRunningNet } from '../src/features/dashboard/cash-flow-series';
import { AccountsPage } from '../src/features/accounts/AccountsPage';
import { BudgetSummaryCards } from '../src/features/budgets/BudgetSummaryCards';
import { ReconciliationPage } from '../src/features/reconciliation/ReconciliationPage';
import { LedgerPage } from '../src/features/ledger/LedgerPage';
import { AuditPage } from '../src/features/audit/AuditPage';
import { LogsPage } from '../src/features/diagnostics/LogsPage';
import { ReceiptsPage } from '../src/features/receipts/ReceiptsPage';
import { CameraCapture } from '../src/features/receipts/CameraCapture';
import {
  PRIMARY_NAV,
  MOBILE_TABS,
  TOOL_GROUPS,
  adjacentTabRoute,
  isMobileRoot,
  screenTitleKey,
  tabStepDirection,
} from '../src/app/navigation';
import { resolveSwipeGesture } from '../src/app/useSwipeNavigation';
import { groupTransactionsByMonth } from '../src/features/transactions/group-by-month';
import { clearAuthSession, setAuthSession } from '../src/lib/auth';
import {
  accountIdForAction,
  captureFromAction,
  categoryIdForCapture,
  hasImportedCapture,
  markCaptureImported,
  nativeImportTransaction,
  parseNotification,
  pruneStaleCaptureSettings,
  type NotificationSettings,
} from '../src/notifications/capture';
import { isOperationFailed } from '../src/offline/database';
import { filterLogEntries, formatLogEntries, redactLogText } from '../src/lib/app-log';
import { expandLocalCategoryIds, filterAndSortLocalTransactions } from '../src/offline/filters';
import { toIsoDate } from '../src/lib/date-input';
import { normalizeServerUrl } from '../src/lib/serverConfig';
import { displayNameForGreeting } from '../src/features/dashboard/greeting';
import { monthDateRange, transactionsLink } from '../src/lib/links';
import { rowKeyboardProps } from '../src/lib/interactive';
import { chartPointAtIndex, chartTooltipTriggerFor } from '../src/lib/chart-events';
import {
  ACCOUNT_BRANDS,
  ACCOUNT_ICON_GROUPS,
  ACCOUNT_ICON_NAMES,
  ACCOUNT_INSTRUMENTS,
  DEFAULT_ACCOUNT_ICON,
  isAccountIconName,
  resolveAccountIconId,
  suggestAccountIcon,
} from '@shared/account-icons';

function Providers({
  children,
  client,
  initialEntry = '/dashboard',
}: {
  children: React.ReactNode;
  client?: QueryClient;
  initialEntry?: string;
}) {
  const fallback = React.useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={client ?? fallback}>
      <AuthProvider>
        <I18nProvider>
          <ThemeProvider>
            <MemoryRouter initialEntries={[initialEntry]}>
              <TooltipProvider>
                <Toaster>
                  <NotificationCaptureProvider>{children}</NotificationCaptureProvider>
                </Toaster>
              </TooltipProvider>
            </MemoryRouter>
          </ThemeProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

let failures = 0;

function renderNode(node: React.ReactNode, client?: QueryClient, initialEntry = '/dashboard') {
  return renderToStaticMarkup(
    <Providers client={client} initialEntry={initialEntry}>
      {node}
    </Providers>,
  );
}

function check(
  label: string,
  node: React.ReactNode,
  needles: string[],
  client?: QueryClient,
  initialEntry = '/dashboard',
) {
  const html = renderNode(node, client, initialEntry);
  for (const needle of needles) {
    if (!html.includes(needle)) {
      console.error(`FAIL: ${label} — missing "${needle}"`);
      failures += 1;
      return;
    }
  }
  console.log(`PASS: ${label} (${html.length} chars)`);
}

function checkAbsent(
  label: string,
  node: React.ReactNode,
  needles: string[],
  client?: QueryClient,
  initialEntry = '/dashboard',
) {
  const html = renderNode(node, client, initialEntry);
  for (const needle of needles) {
    if (html.includes(needle)) {
      console.error(`FAIL: ${label} — unexpectedly found "${needle}"`);
      failures += 1;
      return;
    }
  }
  console.log(`PASS: ${label} (${html.length} chars)`);
}

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
  ],
);

// The phone APK runs inside Tauri, so include Android-only More entries in this
// server-rendered smoke test as well.
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __TAURI_INTERNALS__: {},
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});
check('MorePage', <MorePage />, [
  'Receipts',
  'Scan and track prices',
  'Notification Capture',
  'Capture bank alerts as transactions',
  'Pending review',
  'Confirm captured transactions',
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

check('TransactionsPage (empty state + right column)', <TransactionsPage />, [
  'aria-label="Export CSV"',
  'Top spending categories', // right-hand column card
  'aria-label="Month"', // summary card's month selector
]);

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
    credit_limit: '5000.00',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Tesouro Selic',
    account_kind: 'investment',
    type: 'asset',
    balance: '8000.00',
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
for (const needle of [
  'Bank accounts',
  'Nubank',
  'max-md:w-full',
  'grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,1fr)]', // phone-safe account grid
  'aria-label="Transfer"',
  'Total in accounts', // friendly summary labels
  'Card bills &amp; loans', // React escapes the `&`
  'Net worth',
  'Credit used',
  'Available',
  'Tesouro Selic', // investments card row
  'md:hidden', // compact phone summary card
  'overflow-hidden rounded-lg border border-border bg-surface shadow-card', // separate account groups
]) {
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

check(
  'BudgetSummaryCards (phone summary card)',
  <BudgetSummaryCards
    loading={false}
    totals={{
      hasOverall: true,
      limit: 5000,
      spent: 3200,
      categoryBudgetCount: 3,
      alertsTotal: 2,
      alertsOver: 1,
    }}
    monthLabel="September 2026"
    onSetOverall={() => undefined}
  />,
  [
    'md:hidden',
    'hidden grid-cols-1 gap-4 md:grid md:grid-cols-2 xl:grid-cols-4',
    'divide-y divide-border/60',
    'Total budget',
    'Total spent',
    'Remaining',
    'Active alerts',
  ],
);

check('DashboardPage (phone lead + month nav)', <DashboardPage />, [
  'aria-label="Previous month"',
  'aria-label="Next month"',
  'order-3 grid min-w-0 grid-cols-1 gap-4 md:order-4',
  'order-4 grid min-w-0 grid-cols-1 gap-4 md:order-3',
  'md:order-3',
]);

// Dashboard with data: the activity table, the budget table and the reworded
// savings-rate hint (all fed by the same seeded queries the app uses).
const dashClient = new QueryClient();
const dashNow = new Date();
const dashYear = dashNow.getFullYear();
const dashMonth = dashNow.getMonth() + 1;
const dashDate = `${dashYear}-${String(dashMonth).padStart(2, '0')}-05`;
const dashCategoryId = '33333333-3333-3333-3333-333333333333';
const dashAccountId = '11111111-1111-1111-1111-111111111111';
const dashCardAccountId = '22222222-2222-2222-2222-222222222222';
const dashCardDueDate = `${dashYear}-${String(dashMonth).padStart(2, '0')}-22`;

dashClient.setQueryData(['accounts'], [
  {
    id: dashAccountId,
    name: 'Nubank',
    account_kind: 'bank',
    type: 'asset',
    balance: '5420.20',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: dashCardAccountId,
    name: 'Nubank Visa',
    account_kind: 'card',
    type: 'liability',
    balance: '-1240.80',
    closing_day: 15,
    due_day: 22,
    credit_limit: '5000.00',
    created_at: '2026-01-01T00:00:00Z',
  },
]);
dashClient.setQueryData(['categories'], [
  {
    id: dashCategoryId,
    name: 'Food',
    type: 'expense',
    icon: 'utensils',
    color: '#10b981',
    created_at: '2026-01-01T00:00:00Z',
  },
]);
dashClient.setQueryData(['summary', dashYear, dashMonth], {
  income_total: '5000.00',
  expense_total: '1250.00',
  by_category: [
    {
      category_id: dashCategoryId,
      category_name: 'Food',
      icon: 'utensils',
      color: '#10b981',
      total: '1250.00',
    },
  ],
});
dashClient.setQueryData(['transactions', 'recent', dashYear, dashMonth], {
  items: [
    {
      id: '44444444-4444-4444-4444-444444444444',
      description: 'Padaria breakfast',
      amount: '89.90',
      type: 'expense',
      category_id: dashCategoryId,
      account_id: dashCardAccountId,
      date: dashDate,
      card_due_date: dashCardDueDate,
      installment_plan_id: null,
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  page: 0,
  page_size: 8,
  total: 1,
});
dashClient.setQueryData(['budget-summary', dashYear, dashMonth], {
  month: dashMonth,
  year: dashYear,
  total_budgeted: '1500.00',
  total_spent: '1250.00',
  items: [
    {
      actual_spent: '1250.00',
      percentage: '83.3',
      remaining: '250.00',
      budget: {
        id: '55555555-5555-5555-5555-555555555555',
        category_id: dashCategoryId,
        category_name: 'Food',
        icon: 'utensils',
        amount_limit: '1500.00',
        month: dashMonth,
        year: dashYear,
        created_at: '2026-01-01T00:00:00Z',
      },
    },
  ],
});

const dashboardHtml = renderToStaticMarkup(
  <Providers client={dashClient}>
    <DashboardPage />
  </Providers>,
);
const dashboardNeedles = [
  'Cash flow', // cash-flow card title remains after removing its redundant subtitle
  'Account/Card', // activity table gained an account/card column
  'Padaria breakfast', // seeded activity row
  'Spent / Limit', // budget card renders as a table
  'income you kept', // savings-rate hint replaced "of income saved"
  'md:hidden', // phone-specific summary/list variants
  'hidden md:block', // desktop tables remain gated to wider layouts
];
const dashboardMissing = dashboardNeedles.filter((needle) => !dashboardHtml.includes(needle));
const dashboardUnexpected = ['Income, expenses and running net'].filter((needle) => dashboardHtml.includes(needle));
const billDueOccurrences = (dashboardHtml.match(/bill due/g) ?? []).length;
if (dashboardMissing.length > 0 || dashboardUnexpected.length > 0) {
  console.error(
    `FAIL: DashboardPage (with data) — missing ${JSON.stringify(dashboardMissing)}, unexpected ${JSON.stringify(dashboardUnexpected)}`,
  );
  failures += 1;
} else if (billDueOccurrences !== 1) {
  console.error(
    `FAIL: DashboardPage (card bill due text) — expected one desktop occurrence, found ${billDueOccurrences}`,
  );
  failures += 1;
} else {
  console.log(`PASS: DashboardPage (with data) (${dashboardHtml.length} chars)`);
}

const runningNetChecks: [string, boolean][] = [
  [
    'accumulates positive and negative periods',
    withRunningNet([
      { label: 'Jan', income: 100, expenses: 40, net: 60, running: 0 },
      { label: 'Feb', income: 20, expenses: 50, net: -30, running: 0 },
      { label: 'Mar', income: 0, expenses: 10, net: -10, running: 0 },
    ]).every((point, index) => point.running === [60, 30, 20][index]),
  ],
  [
    'supports a zero crossing',
    withRunningNet([
      { label: 'Jan', income: 10, expenses: 30, net: -20, running: 0 },
      { label: 'Feb', income: 50, expenses: 10, net: 40, running: 0 },
    ])[1].running === 20,
  ],
  ['handles a single point', withRunningNet([{ label: 'Jan', income: 10, expenses: 3, net: 7, running: 0 }])[0].running === 7],
  ['handles an empty series', withRunningNet([]).length === 0],
];
for (const [label, ok] of runningNetChecks) {
  if (!ok) {
    console.error(`FAIL: cumulative net — ${label}`);
    failures += 1;
  }
}
if (runningNetChecks.every(([, ok]) => ok)) {
  console.log(`PASS: cumulative net (${runningNetChecks.length} cases)`);
}

// DateField: typeable locale input plus an in-app calendar, so the modal never
// depends on the WebView's native date popup.
const dateHtml = renderToStaticMarkup(
  <Providers>
    <DateField value="2026-09-14" onChange={() => undefined} />
  </Providers>,
);
const dateNeedles = [
  '09/14/2026', // en-US month/day/year order
  'placeholder="mm/dd/yyyy"',
  'aria-label="Choose a date"',
];
const dateMissing = dateNeedles.filter((needle) => !dateHtml.includes(needle));
if (dateMissing.length > 0 || dateHtml.includes('type="date"')) {
  console.error(
    `FAIL: DateField — missing ${JSON.stringify(dateMissing)}, native=${dateHtml.includes('type="date"')}`,
  );
  failures += 1;
} else {
  console.log(`PASS: DateField (typed input + in-app calendar) (${dateHtml.length} chars)`);
}

const ptOrder = dateOrder('pt-BR');
const enOrder = dateOrder('en-US');
const parseChecks: [string, boolean][] = [
  ['pt-BR uses day/month/year', ptOrder.fields.join('') === 'dmy' && ptOrder.separator === '/'],
  ['en-US uses month/day/year', enOrder.fields.join('') === 'mdy'],
  ['pt-BR typed date', parseTypedDate('22/11/2026', ptOrder) === '2026-11-22'],
  ['en-US typed date', parseTypedDate('11/22/2026', enOrder) === '2026-11-22'],
  ['ISO is accepted as typed', parseTypedDate('2026-11-22', ptOrder) === '2026-11-22'],
  ['two-digit year', parseTypedDate('22/11/26', ptOrder) === '2026-11-22'],
  ['dashes are accepted', parseTypedDate('22-11-2026', ptOrder) === '2026-11-22'],
  ['impossible day rejected', parseTypedDate('31/02/2026', ptOrder) === null],
  ['month out of range rejected', parseTypedDate('22/13/2026', ptOrder) === null],
  [
    'garbage rejected',
    parseTypedDate('tomorrow', ptOrder) === null && parseTypedDate('2026-11', ptOrder) === null,
  ],
  [
    'placeholders follow the locale',
    datePlaceholder(ptOrder, 'pt-BR') === 'dd/mm/aaaa' &&
      datePlaceholder(enOrder, 'en') === 'mm/dd/yyyy',
  ],
  ['seven weekday labels', weekdayLabels('en-US').length === 7],
];
for (const [label, ok] of parseChecks) {
  if (!ok) {
    console.error(`FAIL: date parsing — ${label}`);
    failures += 1;
  }
}
if (parseChecks.every(([, ok]) => ok)) {
  console.log(`PASS: date parsing (${parseChecks.length} cases)`);
}

const captureChecks: [string, boolean][] = [
  (() => {
    const parsed = parseNotification(
      'Compra no crédito aprovada Compra de R$ 11,77 APROVADA em DEEPSEERWEA para o cartão com final 2985.',
      [],
      null,
    );
    return [
      'Nubank credit notification',
      parsed?.type === 'expense' &&
        parsed.amount === '11.77' &&
        parsed.description === 'DEEPSEERWEA' &&
        parsed.date === toIsoDate(new Date()),
    ];
  })(),
  (() => {
    const parsed = parseNotification('Você recebeu um Pix de R$ 50,00 de JOÃO SILVA', [], null);
    return [
      'received Pix notification',
      parsed?.type === 'income' && parsed.amount === '50.00' && parsed.description === 'JOÃO SILVA',
    ];
  })(),
  (() => {
    const parsed = parseNotification('Pix enviado de R$ 12,50 para MARIA SOUZA', [], null);
    return [
      'sent Pix notification',
      parsed?.type === 'expense' && parsed.amount === '12.50' && parsed.description === 'MARIA SOUZA',
    ];
  })(),
  ['non-financial notification is ignored', parseNotification('Bateria fraca, conecte o carregador', [], null) === null],
];
for (const [label, ok] of captureChecks) {
  if (!ok) {
    console.error(`FAIL: notification capture — ${label}`);
    failures += 1;
  }
}
if (captureChecks.every(([, ok]) => ok)) {
  console.log(`PASS: notification capture parsing (${captureChecks.length} cases)`);
}

const actionSettings = {
  defaultCategoryId: 'default-expense-category',
  debitAccountId: 'checking-account',
  creditAccountId: 'credit-card-account',
};
const actionSettingsChecks: [string, boolean][] = [
  ['credit uses the configured credit-card account', accountIdForAction('credit', actionSettings) === 'credit-card-account'],
  [
    'expense action uses the current default category',
    categoryIdForCapture({ type: 'expense', categoryId: null }, actionSettings) ===
      'default-expense-category',
  ],
  [
    'guessed category wins over the default',
    categoryIdForCapture({ type: 'expense', categoryId: 'guessed-category' }, actionSettings) ===
      'guessed-category',
  ],
  ['income does not use an expense default', categoryIdForCapture({ type: 'income', categoryId: null }, actionSettings) === null],
];
for (const [label, ok] of actionSettingsChecks) {
  if (!ok) {
    console.error(`FAIL: capture action settings — ${label}`);
    failures += 1;
  }
}
if (actionSettingsChecks.every(([, ok]) => ok)) {
  console.log(`PASS: capture action settings (${actionSettingsChecks.length} cases)`);
}

const actionRecoveryChecks: [string, boolean][] = [
  (() => {
    // A listener-posted tap carries the raw notification, so it is re-parsed.
    const rebuilt = captureFromAction(
      { action: 'credit', title: 'Nubank', text: 'Compra aprovada de R$ 23,50 em PADARIA DO ZE' },
      { defaultCategoryId: 'default-expense-category' },
    );
    return [
      'action rebuilds the capture from the raw notification',
      rebuilt?.parsed.type === 'expense' &&
        rebuilt.parsed.amount === '23.50' &&
        rebuilt.parsed.description === 'PADARIA DO ZE',
    ];
  })(),
  (() => {
    // An in-app prompt has its localized body as `text`; the parsed fields
    // carried by the action must win so the rebuilt dedup key matches the inbox.
    const rebuilt = captureFromAction(
      {
        action: 'income',
        amount: '50,00',
        description: 'JOÃO SILVA',
        date: '2026-09-16',
        categoryId: 'cat-income',
        title: 'Nubank transaction detected',
        text: 'Compra aprovada de R$ 99,90 em LOJA X',
        app_label: 'Nubank',
      },
      { defaultCategoryId: 'default-expense-category' },
    );
    return [
      'parsed fields win over the prompt body',
      rebuilt?.parsed.type === 'income' &&
        rebuilt.parsed.amount === '50.00' &&
        rebuilt.parsed.description === 'JOÃO SILVA' &&
        rebuilt.parsed.date === '2026-09-16' &&
        rebuilt.parsed.categoryId === 'cat-income' &&
        rebuilt.appName === 'Nubank',
    ];
  })(),
  [
    'action without a usable amount cannot be rebuilt',
    captureFromAction({ action: 'credit' }, { defaultCategoryId: null }) === null,
  ],
  (() => {
    const native = nativeImportTransaction({
      type: 'expense',
      amount: '11,77',
      description: 'DEEPSEERWEA',
      date: '2026-09-16',
      category_id: 'cat-1',
    });
    return [
      'native import mirrors the uploaded transaction',
      native?.type === 'expense' &&
        native.amount === '11.77' &&
        native.description === 'DEEPSEERWEA' &&
        native.date === '2026-09-16' &&
        native.categoryId === 'cat-1',
    ];
  })(),
  [
    'native import without a positive amount is ignored',
    nativeImportTransaction({ type: 'income', amount: '0', description: 'x' }) === null,
  ],
  (() => {
    const native = nativeImportTransaction({ type: 'income', amount: '50.00', description: '' });
    return ['native import falls back to a generic description', native?.description === 'Notificação bancária'];
  })(),
];
for (const [label, ok] of actionRecoveryChecks) {
  if (!ok) {
    console.error(`FAIL: capture action recovery — ${label}`);
    failures += 1;
  }
}
if (actionRecoveryChecks.every(([, ok]) => ok)) {
  console.log(`PASS: capture action recovery (${actionRecoveryChecks.length} cases)`);
}

const baseSettings: NotificationSettings = {
  enabled: true,
  monitoredApps: [],
  mode: 'ask',
  defaultCategoryId: 'cat-1',
  pushPrompt: true,
  debitAccountId: 'acc-1',
  creditAccountId: 'acc-credit',
};

const offlineGuardChecks: [string, boolean][] = [
  ['a fresh operation still has retries', !isOperationFailed({ attempts: 0 })],
  ['a missing attempt count is treated as fresh', !isOperationFailed({})],
  ['three attempts mark an operation as failed', isOperationFailed({ attempts: 3 })],
  ['more attempts stay failed', isOperationFailed({ attempts: 9 })],
  (() => {
    // This is the bug that silently dropped every capture: ids from the previous
    // server survive a server switch and the new server rejects the import.
    const pruned = pruneStaleCaptureSettings(baseSettings, {
      accounts: [{ id: 'acc-1' }],
      categories: [{ id: 'other-category' }],
    });
    return [
      'capture settings from another server are cleared',
      pruned.changed &&
        pruned.settings.debitAccountId === 'acc-1' &&
        pruned.settings.creditAccountId === null &&
        pruned.settings.defaultCategoryId === null,
    ];
  })(),
  (() => {
    const pruned = pruneStaleCaptureSettings(baseSettings, {
      accounts: [{ id: 'acc-1' }, { id: 'acc-credit' }],
      categories: [{ id: 'cat-1' }],
    });
    return ['settings that still exist are kept', !pruned.changed];
  })(),
  (() => {
    // While the queries are loading/offline the ids must not be wiped.
    const pruned = pruneStaleCaptureSettings(baseSettings, {});
    return ['unknown account lists leave the settings alone', !pruned.changed];
  })(),
];
for (const [label, ok] of offlineGuardChecks) {
  if (!ok) {
    console.error(`FAIL: offline sync guards — ${label}`);
    failures += 1;
  }
}
if (offlineGuardChecks.every(([, ok]) => ok)) {
  console.log(`PASS: offline sync guards (${offlineGuardChecks.length} cases)`);
}

const logEntries = [
  {
    id: 1,
    at: '2026-09-19T10:00:00.000Z',
    level: 'info' as const,
    source: 'sync' as const,
    message: 'pushed=1 pulled=2tx/0cat failed=0',
  },
  {
    id: 2,
    at: '2026-09-19T10:00:01.000Z',
    level: 'error' as const,
    source: 'capture' as const,
    message: 'action credit for capture cap-1',
    detail: 'Failed to resolve posting account',
  },
];
const logHelperChecks: [string, boolean][] = [
  [
    'logs mask bearer tokens',
    redactLogText('Authorization: Bearer abc.def-ghi') === 'Authorization: Bearer ***',
  ],
  [
    'logs mask token fields',
    redactLogText('{"access_token":"super-secret"}') === '{"access_token":"***"}',
  ],
  [
    'logs filter by level and source',
    filterLogEntries(logEntries, { level: 'error', source: 'capture' }).length === 1 &&
      filterLogEntries(logEntries, { level: 'info' }).length === 1,
  ],
  [
    'logs search matches the detail text',
    filterLogEntries(logEntries, { query: 'posting account' }).length === 1,
  ],
  [
    'logs format includes time, level, source and detail',
    (() => {
      const text = formatLogEntries(logEntries);
      return (
        text.includes('[ERROR] capture: action credit for capture cap-1') &&
        text.includes('Failed to resolve posting account')
      );
    })(),
  ],
];
for (const [label, ok] of logHelperChecks) {
  if (!ok) {
    console.error(`FAIL: diagnostics log — ${label}`);
    failures += 1;
  }
}
if (logHelperChecks.every(([, ok]) => ok)) {
  console.log(`PASS: diagnostics log (${logHelperChecks.length} cases)`);
}

const persistedDedupKey = 'expense|12.50|merchant|2026-09-16';
await markCaptureImported(persistedDedupKey);
if (hasImportedCapture(persistedDedupKey)) {
  console.log('PASS: persistent capture dedup journal');
} else {
  console.error('FAIL: persistent capture dedup journal');
  failures += 1;
}

const localFilterRows = [
  {
    id: 'a', server_id: null, description: 'Later expense', amount: '20.00', type: 'expense' as const,
    category_id: 'child', date: '2026-09-15', notes: null, installment_plan_id: null, account_id: 'bank',
    synced: 0, updated_at: '2026-09-15T00:00:00Z',
  },
  {
    id: 'b', server_id: null, description: 'Income', amount: '100.00', type: 'income' as const,
    category_id: null, date: '2026-09-16', notes: null, installment_plan_id: null, account_id: 'bank',
    synced: 1, updated_at: '2026-09-16T00:00:00Z',
  },
];
const localFilterResult = filterAndSortLocalTransactions(localFilterRows, {
  type: 'expense', start_date: '2026-09-16', end_date: '2026-09-16',
});
const localIncomeResult = filterAndSortLocalTransactions(localFilterRows, { type: 'income' });
const expandedCategoryIds = expandLocalCategoryIds([
  {
    id: 'parent', server_id: null, name: 'Parent', type: 'expense', parent_id: null,
    icon: null, color: null, synced: 1, updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'child', server_id: null, name: 'Child', type: 'expense', parent_id: 'parent',
    icon: null, color: null, synced: 1, updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'grandchild', server_id: null, name: 'Grandchild', type: 'expense', parent_id: 'child',
    icon: null, color: null, synced: 1, updated_at: '2026-09-01T00:00:00Z',
  },
], 'parent');
const localSubcategoryResult = filterAndSortLocalTransactions(localFilterRows, {
  category_id: 'parent', category_ids: expandedCategoryIds,
});
if (
  localFilterResult.total === 0 &&
  localFilterResult.items.length === 0 &&
  localIncomeResult.total === 1 &&
  localIncomeResult.items[0]?.description === 'Income' &&
  expandedCategoryIds.length === 3 &&
  localSubcategoryResult.total === 1 &&
  localSubcategoryResult.items[0]?.description === 'Later expense'
) {
  console.log('PASS: offline transaction filters');
} else {
  console.error('FAIL: offline transaction filters');
  failures += 1;
}

const rangeEmptyHtml = renderToStaticMarkup(
  <Providers>
    <DateRangeField startDate="" endDate="" onChange={() => undefined} />
  </Providers>,
);
const rangeSetHtml = renderToStaticMarkup(
  <Providers>
    <DateRangeField startDate="2026-09-01" endDate="2026-09-30" onChange={() => undefined} />
  </Providers>,
);
const rangeChecks: [string, boolean][] = [
  ['empty range reads as "any date"', rangeEmptyHtml.includes('Any date')],
  ['range control is labelled', rangeEmptyHtml.includes('aria-label="Date range"')],
  [
    'active range is shown in one box',
    rangeSetHtml.includes('Sep 01, 2026') && rangeSetHtml.includes('Sep 30, 2026'),
  ],
];
for (const [label, ok] of rangeChecks) {
  if (!ok) {
    console.error(`FAIL: DateRangeField — ${label}`);
    failures += 1;
  }
}
if (rangeChecks.every(([, ok]) => ok)) {
  console.log('PASS: DateRangeField (single range control)');
}

const checkboxHtml = renderToStaticMarkup(
  <Checkbox checked onChange={() => undefined} aria-label="pick" />,
);
if (checkboxHtml.includes('type="checkbox"') && checkboxHtml.includes('aria-label="pick"')) {
  console.log('PASS: Checkbox (row selection)');
} else {
  console.error('FAIL: Checkbox — missing native checkbox markup');
  failures += 1;
}

// A crashed screen must show the recoverable fallback instead of a blank page
// (the accounts detail crash that used to take the whole app down). SSR cannot
// exercise a client-side error boundary, so the pieces are checked directly:
// the boundary captures the error and the fallback offers a retry.
const captured = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
const fallbackHtml = renderToStaticMarkup(
  <Providers>
    <ErrorFallback error={new Error('boom')} onRetry={() => undefined} />
  </Providers>,
);
if (captured.error instanceof Error && fallbackHtml.includes('This screen hit an error')) {
  console.log('PASS: ErrorBoundary (captures the crash, fallback offers a retry)');
} else {
  console.error('FAIL: ErrorBoundary — crash handling is not wired up');
  failures += 1;
}

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

check('AuditPage (audit trail for every user)', <AuditPage />, [
  'Audit Log',
  'No audit events found',
]);

check('LogsPage (diagnostics)', <LogsPage />, [
  'Diagnostics log',
  'Search messages',
  'All levels',
  // Phone-friendly controls: the Follow switch keeps a full-height touch target.
  'flex min-h-11 items-center gap-2 text-sm text-muted-foreground md:min-h-0',
]);

check('ReceiptsPage (phone capture shortcuts)', <ReceiptsPage />, [
  'Scan QR code',
  'Receipt photo',
  'Overview',
  'Items &amp; Prices',
  'w-fit max-w-full', // tab bar hugs its tabs instead of spanning the page
]);
check('ReceiptsPage (overview containment)', <ReceiptsPage />, [
  'grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]',
  'min-w-0 border-border bg-surface shadow-card',
], (() => {
  const client = new QueryClient();
  client.setQueryData(['receipts', 'stats'], {
    total_receipts: 1,
    receipts_this_month: 1,
    total_spent: '0',
    items_tracked: 0,
    price_records: 0,
    store_count: 0,
  });
  return client;
})());
check(
  'ReceiptsPage (receipt filters)',
  <ReceiptsPage />,
  ['aria-label="Filters"', 'max-md:hidden', 'max-md:h-11'],
  undefined,
  '/receipts?tab=receipts',
);
check(
  'ReceiptsPage (items and stores controls)',
  <ReceiptsPage />,
  ['overflow-x-auto rounded-md bg-muted'],
  undefined,
  '/receipts?tab=items',
);
check(
  'ReceiptsPage (stores filters)',
  <ReceiptsPage />,
  ['aria-label="Filters"', 'max-md:hidden', 'max-md:h-11'],
  undefined,
  '/receipts?tab=stores',
);

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __TAURI_INTERNALS__: {},
    isSecureContext: true,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: () => Promise.resolve({}) } },
});

check(
  'ReceiptsPage (four capture paths)',
  <ReceiptsPage />,
  [
    'NFC-e QR code',
    'Read QR code with camera',
    'Read QR code from picture',
    'Receipt OCR',
    'Photograph receipt',
    'Read receipt from picture',
  ],
  undefined,
  '/receipts?tab=scan',
);
checkAbsent(
  'ReceiptsPage (manual QR entry removed)',
  <ReceiptsPage />,
  ['<textarea'],
  undefined,
  '/receipts?tab=scan',
);
check(
  'CameraCapture (close control)',
  <CameraCapture mode="photo" onClose={() => undefined} />,
  ['Close camera'],
  undefined,
  '/receipts?tab=scan',
);

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
  ['swipe next from dashboard', adjacentTabRoute('/dashboard', 'next') === '/transactions'],
  ['swipe prev from transactions', adjacentTabRoute('/transactions', 'prev') === '/dashboard'],
  ['swipe does not wrap before first tab', adjacentTabRoute('/dashboard', 'prev') === null],
  ['swipe does not wrap after last tab', adjacentTabRoute('/more', 'next') === null],
  ['swipe ignores tool screens', adjacentTabRoute('/ledger', 'next') === null],
  ['tab transition moves forward', tabStepDirection('/dashboard', '/transactions') === 1],
  ['tab transition moves backward', tabStepDirection('/transactions', '/dashboard') === -1],
  ['non-tab transition has no direction', tabStepDirection('/ledger', '/dashboard') === 0],
];
for (const [label, ok] of navChecks) {
  if (!ok) {
    console.error(`FAIL: nav model — ${label}`);
    failures += 1;
  }
}
if (failures === 0) console.log(`PASS: nav model (${MOBILE_TABS.length} tabs, ${toolKeys.length} tools)`);

const swipeChecks: [string, boolean][] = [
  [
    'left swipe advances',
    resolveSwipeGesture({ startX: 180, startY: 200, x: 100, y: 208, durationMs: 220, viewportWidth: 360 }) === 'next',
  ],
  [
    'right swipe goes back',
    resolveSwipeGesture({ startX: 180, startY: 200, x: 260, y: 208, durationMs: 220, viewportWidth: 360 }) === 'prev',
  ],
  [
    'short drag is ignored',
    resolveSwipeGesture({ startX: 180, startY: 200, x: 140, y: 205, durationMs: 220, viewportWidth: 360 }) === null,
  ],
  [
    'vertical drag is ignored',
    resolveSwipeGesture({ startX: 180, startY: 200, x: 220, y: 280, durationMs: 220, viewportWidth: 360 }) === null,
  ],
  [
    'multi-touch is ignored',
    resolveSwipeGesture({ startX: 180, startY: 200, x: 100, y: 208, durationMs: 220, viewportWidth: 360, touchCount: 2 }) === null,
  ],
  [
    'edge swipe is ignored',
    resolveSwipeGesture({ startX: 20, startY: 200, x: 100, y: 208, durationMs: 220, viewportWidth: 360 }) === null,
  ],
  [
    'long swipe is ignored',
    resolveSwipeGesture({ startX: 180, startY: 200, x: 100, y: 208, durationMs: 601, viewportWidth: 360 }) === null,
  ],
  [
    'desktop swipe is ignored',
    resolveSwipeGesture({ startX: 400, startY: 200, x: 300, y: 208, durationMs: 220, viewportWidth: 1024 }) === null,
  ],
];
for (const [label, ok] of swipeChecks) {
  if (!ok) {
    console.error(`FAIL: swipe gesture — ${label}`);
    failures += 1;
  }
}
if (swipeChecks.every(([, ok]) => ok)) {
  console.log(`PASS: swipe gesture (${swipeChecks.length} cases)`);
}

const accountIconIds = ACCOUNT_ICON_GROUPS.flatMap((group) => group.options.map((option) => option.name));
const accountIconChecks: [string, boolean][] = [
  ['catalog has no duplicate ids', new Set(accountIconIds).size === accountIconIds.length],
  ['catalog covers every icon id', ACCOUNT_ICON_NAMES.every((name) => accountIconIds.includes(name))],
  ['brand monograms are compact', ACCOUNT_BRANDS.every((brand) => brand.monogram.length <= 2)],
  ['brand colors are hex values', ACCOUNT_BRANDS.every((brand) => /^#[0-9A-F]{6}$/i.test(brand.color))],
  ['instrument catalog is populated', ACCOUNT_INSTRUMENTS.length >= 10],
  ['legacy icon remains valid', isAccountIconName('wallet')],
  ['brand icon is valid', isAccountIconName('nubank')],
  ['unknown icon is rejected', !isAccountIconName('not-an-account-icon')],
  ['kind fallback resolves', resolveAccountIconId(null, 'bank') === DEFAULT_ACCOUNT_ICON.bank],
  ['invalid icon uses kind fallback', resolveAccountIconId('not-an-account-icon', 'investment') === 'trending-up'],
  ['valid brand wins over kind fallback', resolveAccountIconId('nubank', 'card') === 'nubank'],
  ['suggests Nubank', suggestAccountIcon('Cartão Nubank') === 'nubank'],
  ['suggests Itaú', suggestAccountIcon('Itaú Uniclass') === 'itau'],
  ['suggests Tesouro Direto', suggestAccountIcon('Tesouro IPCA+ 2029') === 'tesouro'],
  ['suggests CDB before bank mention', suggestAccountIcon('CDB Inter 110%') === 'cdb'],
  ['suggests Poupança before BB mention', suggestAccountIcon('Poupança BB') === 'poupanca'],
  ['suggests FII', suggestAccountIcon('Fundo Imobiliário') === 'fii'],
  ['does not suggest generic salary', suggestAccountIcon('Salário') === null],
];
for (const [label, ok] of accountIconChecks) {
  if (!ok) {
    console.error(`FAIL: account icons — ${label}`);
    failures += 1;
  }
}
if (accountIconChecks.every(([, ok]) => ok)) {
  console.log(`PASS: account icons (${accountIconChecks.length} cases)`);
}

const greetingChecks: [string, boolean][] = [
  ['uses first word of display name', displayNameForGreeting({ display_name: 'Diego Braga', email: 'diego.braga92@example.com' }) === 'Diego'],
  ['trims display name before taking first word', displayNameForGreeting({ display_name: '  Ana   Souza  ' }) === 'Ana'],
  ['falls back to email handle', displayNameForGreeting({ email: 'diego.braga92@example.com' }) === 'Diego.braga92'],
  ['returns null without identity', displayNameForGreeting(null) === null],
];
for (const [label, ok] of greetingChecks) {
  if (!ok) {
    console.error(`FAIL: greeting — ${label}`);
    failures += 1;
  }
}
if (greetingChecks.every(([, ok]) => ok)) {
  console.log(`PASS: greeting (${greetingChecks.length} cases)`);
}

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

const serverUrlChecks: [string, boolean][] = [
  ['server URL trims whitespace and trailing slash', normalizeServerUrl('  http://10.0.2.2:3000/// ') === 'http://10.0.2.2:3000'],
  ['server URL removes pasted sentence punctuation', normalizeServerUrl('http://10.0.2.2:3000.') === 'http://10.0.2.2:3000'],
  ['server URL adds protocol once', normalizeServerUrl('10.0.2.2:3000') === 'http://10.0.2.2:3000'],
  ['server URL does not concatenate values', normalizeServerUrl('http://new.example:3000') === 'http://new.example:3000'],
];
for (const [label, ok] of serverUrlChecks) {
  if (!ok) {
    console.error(`FAIL: server URL normalization — ${label}`);
    failures += 1;
  }
}
if (serverUrlChecks.every(([, ok]) => ok)) {
  console.log(`PASS: server URL normalization (${serverUrlChecks.length} cases)`);
}

// The stored session is what lets the app skip the login screen on the next
// launch, so a missing write here is exactly the "why am I logged out again?"
// bug. Written through the same seam the app uses (`lib/auth`).
await setAuthSession('access-1', 'refresh-1', {
  id: 'u1',
  email: 'dev@pudim.test',
  role: 'user',
});

const interactionChecks: [string, boolean][] = [
  [
    'transaction links encode category and date filters',
    transactionsLink({ categoryId: 'food & drink', type: 'expense', startDate: '2026-09-01', endDate: '2026-09-30' }) ===
      '/transactions?category_id=food+%26+drink&type=expense&start_date=2026-09-01&end_date=2026-09-30',
  ],
  [
    'budget links open filtered transactions including subcategories',
    transactionsLink({
      categoryId: 'home & bills',
      type: 'expense',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      includeSubcategories: true,
    }) ===
      '/transactions?category_id=home+%26+bills&type=expense&start_date=2026-09-01&end_date=2026-09-30&include_subcategories=true',
  ],
  [
    'month ranges include the calendar month end',
    JSON.stringify(monthDateRange(2024, 2)) === JSON.stringify({ startDate: '2024-02-01', endDate: '2024-02-29' }),
  ],
  [
    'row keyboard props activate on Enter',
    (() => {
      let activated = false;
      const props = rowKeyboardProps(() => {
        activated = true;
      });
      props.onKeyDown?.({ key: 'Enter', preventDefault: () => undefined } as never);
      return activated;
    })(),
  ],
  [
    'row keyboard props activate on Space',
    (() => {
      let activated = false;
      const props = rowKeyboardProps(() => {
        activated = true;
      });
      props.onKeyDown?.({ key: ' ', preventDefault: () => undefined } as never);
      return activated;
    })(),
  ],
  [
    'chart event resolves the active Recharts index',
    chartPointAtIndex(
      { activeTooltipIndex: '1', activeCoordinate: { x: 40, y: 20 } },
      ['first', 'second'],
    ) === 'second',
  ],
  [
    'chart event falls back to activeIndex',
    chartPointAtIndex(
      { activeIndex: 0, activeCoordinate: { x: 10, y: 30 } },
      ['first'],
    ) === 'first',
  ],
  [
    'chart event rejects blank-area clicks',
    chartPointAtIndex({ activeIndex: 0 }, ['first']) === undefined,
  ],
  [
    'chart event rejects an out-of-range index',
    chartPointAtIndex(
      { activeTooltipIndex: 4, activeCoordinate: { x: 10, y: 30 } },
      ['first'],
    ) === undefined,
  ],
  [
    'coarse layouts use click-triggered chart tooltips',
    chartTooltipTriggerFor(true) === 'click',
  ],
  [
    'pointer layouts preserve hover-triggered chart tooltips',
    chartTooltipTriggerFor(false) === 'hover',
  ],
];
for (const [label, ok] of interactionChecks) {
  if (!ok) {
    console.error(`FAIL: interaction helpers — ${label}`);
    failures += 1;
  }
}
if (interactionChecks.every(([, ok]) => ok)) {
  console.log(`PASS: interaction helpers (${interactionChecks.length} cases)`);
}
const storedToken = store.get('pudim_token');
const storedUser = store.get('pudim_user') ?? '';
const storedRefresh = store.get('pudim_refresh_token');
await clearAuthSession();
const afterClear = store.get('pudim_token') ?? null;
const sessionChecks: [string, boolean][] = [
  ['access token persisted', storedToken === 'access-1'],
  ['refresh token persisted', storedRefresh === 'refresh-1'],
  ['profile persisted', storedUser.includes('dev@pudim.test')],
  ['logout clears everything', afterClear === null && !store.has('pudim_user')],
];
for (const [label, ok] of sessionChecks) {
  if (!ok) {
    console.error(`FAIL: session persistence — ${label}`);
    failures += 1;
  }
}
if (sessionChecks.every(([, ok]) => ok)) {
  console.log(`PASS: session persistence (${sessionChecks.length} cases)`);
}

if (failures > 0) process.exit(1);
console.log('Android composition checks passed.');
void useAuth;
