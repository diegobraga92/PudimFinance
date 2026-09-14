import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  Target,
  TrendingUp,
  BookOpen,
  ReceiptText,
  ShieldCheck,
  CreditCard,
  Bell,
  Inbox,
  Server,
  House,
  Menu,
} from 'lucide-react';
import type { TranslationKey } from '@shared/i18n';

/**
 * Navigation model for the app shell.
 *
 * The top bar exposes the surfaces a person uses every day; the accounting and
 * administrative tools live behind the "Tools" menu, grouped so the menu reads
 * like a map of the product rather than a backend module list.
 */
export interface NavItem {
  key: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  route: string;
  /** One-line explanation, shown inside the Tools menu. */
  descKey?: TranslationKey;
  /** Only meaningful on Android (hidden on desktop). */
  androidOnly?: boolean;
}

/** A titled group of entries inside the Tools menu. */
export interface NavGroup {
  key: string;
  labelKey: TranslationKey;
  items: NavItem[];
}

/** Primary navigation — the daily money surfaces. */
export const PRIMARY_NAV: NavItem[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, route: '/dashboard' },
  { key: 'transactions', labelKey: 'nav.transactions', icon: ArrowLeftRight, route: '/transactions' },
  { key: 'accounts', labelKey: 'nav.accounts', icon: Wallet, route: '/accounts' },
  { key: 'budgets', labelKey: 'nav.budgets', icon: Target, route: '/budgets' },
  { key: 'reports', labelKey: 'nav.reports', icon: TrendingUp, route: '/reports' },
  // Receipts outgrew "tools": it is a daily surface (scan, history, prices).
  {
    key: 'receipts',
    labelKey: 'nav.receipts',
    icon: ReceiptText,
    route: '/receipts',
    descKey: 'nav.descReceipts',
  },
];

/** Grouped entries rendered inside the "Tools" dropdown. */
export const TOOL_GROUPS: NavGroup[] = [
  {
    key: 'accounting',
    labelKey: 'nav.groupAccounting',
    items: [
      {
        key: 'reconciliation',
        labelKey: 'nav.reconciliation',
        icon: ArrowLeftRight,
        route: '/reconciliation',
        descKey: 'nav.descReconciliation',
      },
      {
        key: 'ledger',
        labelKey: 'nav.ledger',
        icon: BookOpen,
        route: '/ledger',
        descKey: 'nav.descLedger',
      },
      {
        key: 'audit',
        labelKey: 'nav.audit',
        icon: ShieldCheck,
        route: '/audit',
        descKey: 'nav.descAudit',
      },
    ],
  },
  {
    key: 'other',
    labelKey: 'nav.groupOther',
    items: [
      {
        key: 'creditCards',
        labelKey: 'nav.creditCards',
        icon: CreditCard,
        route: '/credit-cards',
        descKey: 'nav.descCreditCards',
      },
      {
        key: 'notifications',
        labelKey: 'nav.notifications',
        descKey: 'nav.descNotifications',
        icon: Bell,
        route: '/notifications',
        androidOnly: true,
      },
      {
        key: 'pendingReview',
        labelKey: 'nav.reviewCaptures',
        descKey: 'nav.descReviewCaptures',
        icon: Inbox,
        route: '/pending-review',
        androidOnly: true,
      },
    ],
  },
  {
    key: 'settings',
    labelKey: 'nav.groupSettings',
    items: [
      {
        key: 'server',
        labelKey: 'nav.server',
        icon: Server,
        route: '/server',
        descKey: 'nav.descServer',
      },
    ],
  },
];

/** Flat list of every tool (used for active-state checks and the mobile menu). */
export const TOOLS_NAV: NavItem[] = TOOL_GROUPS.flatMap((group) => group.items);

/** The screens that make up the Accounting & Data workspace. */
export const ACCOUNTING_TOOLS: NavItem[] = TOOL_GROUPS[0].items;

/**
 * Bottom navigation for phone-sized screens (Android).
 *
 * Five destinations only: the daily money surfaces plus "More", which is where
 * receipts, the accounting tools and settings live.
 */
export const MOBILE_TABS: NavItem[] = [
  { key: 'dashboard', labelKey: 'nav.home', icon: House, route: '/dashboard' },
  { key: 'transactions', labelKey: 'nav.transactions', icon: ArrowLeftRight, route: '/transactions' },
  { key: 'accounts', labelKey: 'nav.accounts', icon: Wallet, route: '/accounts' },
  { key: 'budgets', labelKey: 'nav.budgets', icon: Target, route: '/budgets' },
  { key: 'more', labelKey: 'nav.more', icon: Menu, route: '/more' },
];

/**
 * Screens reachable from the More tab (and the Tools menu), mapped to the title
 * the mobile app bar shows for them. Ordered longest route first so the lookup
 * prefers the most specific match.
 */
const SECONDARY_SCREENS: { prefix: string; labelKey: TranslationKey }[] = [
  { prefix: '/receipts', labelKey: 'nav.receipts' },
  { prefix: '/reconciliation', labelKey: 'nav.reconciliation' },
  { prefix: '/ledger', labelKey: 'nav.ledger' },
  { prefix: '/audit', labelKey: 'nav.audit' },
  { prefix: '/credit-cards', labelKey: 'nav.creditCards' },
  { prefix: '/reports', labelKey: 'nav.reports' },
  { prefix: '/categories', labelKey: 'nav.categories' },
  { prefix: '/notifications', labelKey: 'nav.notifications' },
  { prefix: '/pending-review', labelKey: 'nav.reviewCaptures' },
  { prefix: '/server', labelKey: 'nav.server' },
  { prefix: '/more', labelKey: 'nav.more' },
];

/** Label for the mobile app bar: the tab, the screen, or the dashboard. */
export function screenTitleKey(pathname: string): TranslationKey {
  const tab = MOBILE_TABS.find((item) => pathname.startsWith(item.route));
  if (tab) return tab.labelKey;
  const secondary = SECONDARY_SCREENS.find((entry) => pathname.startsWith(entry.prefix));
  return secondary ? secondary.labelKey : 'nav.dashboard';
}

/** True when `pathname` is one of the five bottom-navigation destinations. */
export function isMobileRoot(pathname: string): boolean {
  return MOBILE_TABS.some((item) => pathname.startsWith(item.route));
}
