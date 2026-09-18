import {
  Banknote,
  CreditCard,
  Landmark,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@shared/i18n';
import { resolveAccountIconId, type AccountIconName } from '@shared/account-icons';

import type { AccountKind } from './AccountForm';
import type { AccountWithBalance } from '@/lib/api';

/** Maps accounting accounts to the groups shown on the accounts page. */
export type AccountGroupKey = 'bank' | 'liabilities' | 'investments' | 'other';

export interface AccountGroupMeta {
  key: AccountGroupKey;
  titleKey: TranslationKey;
  blurbKey: TranslationKey;
  icon: LucideIcon;
  /** Tailwind classes for the group/icon tint. */
  tone: string;
}

/** Display order of the account groups (and of the filter tabs). */
export const ACCOUNT_GROUPS: AccountGroupMeta[] = [
  {
    key: 'bank',
    titleKey: 'accounts.group.bank',
    blurbKey: 'accounts.group.bankBlurb',
    icon: Landmark,
    tone: 'bg-info/15 text-info',
  },
  {
    key: 'liabilities',
    titleKey: 'accounts.group.liabilities',
    blurbKey: 'accounts.group.liabilitiesBlurb',
    icon: CreditCard,
    tone: 'bg-danger/15 text-danger',
  },
  {
    key: 'investments',
    titleKey: 'accounts.group.investments',
    blurbKey: 'accounts.group.investmentsBlurb',
    icon: TrendingUp,
    tone: 'bg-success/15 text-success',
  },
  {
    key: 'other',
    titleKey: 'accounts.group.other',
    blurbKey: 'accounts.group.otherBlurb',
    icon: Banknote,
    tone: 'bg-warning/15 text-warning',
  },
];

/** Tint per account kind, used on the individual row icon boxes. */
const KIND_TONES: Record<AccountKind, string> = {
  bank: 'bg-info/15 text-info',
  cash: 'bg-warning/15 text-warning',
  card: 'bg-danger/15 text-danger',
  loan: 'bg-purple/15 text-purple',
  investment: 'bg-success/15 text-success',
};

/** Chart color per account kind (CSS color strings for Recharts). */
export const KIND_CHART_COLORS: Record<AccountKind, string> = {
  bank: 'rgb(var(--info))',
  cash: 'rgb(var(--warning))',
  card: 'rgb(var(--danger))',
  loan: 'rgb(var(--purple))',
  investment: 'rgb(var(--success))',
};

const KIND_LABEL_KEYS: Record<AccountKind, TranslationKey> = {
  bank: 'accounts.kind.bank',
  cash: 'accounts.kind.cash',
  card: 'accounts.kind.card',
  loan: 'accounts.kind.loan',
  investment: 'accounts.kind.investment',
};

const KIND_ORDER: AccountKind[] = ['bank', 'cash', 'card', 'loan', 'investment'];

/** Known kinds first (in display order), unknown ones last. */
export function sortByKind(accounts: AccountWithBalance[]): AccountWithBalance[] {
  return [...accounts].sort((a, b) => {
    const ai = KIND_ORDER.indexOf(a.account_kind as AccountKind);
    const bi = KIND_ORDER.indexOf(b.account_kind as AccountKind);
    return (ai === -1 ? KIND_ORDER.length : ai) - (bi === -1 ? KIND_ORDER.length : bi);
  });
}

/** Narrows the API's free-form `account_kind` to a known kind. */
export function asAccountKind(kind?: string | null): AccountKind | null {
  return KIND_ORDER.includes(kind as AccountKind) ? (kind as AccountKind) : null;
}

/** Maps an account to the group it is displayed in. */
export function groupOf(account: AccountWithBalance): AccountGroupKey {
  switch (asAccountKind(account.account_kind)) {
    case 'bank':
    case 'cash':
      return 'bank';
    case 'card':
    case 'loan':
      return 'liabilities';
    case 'investment':
      return 'investments';
    default:
      return 'other';
  }
}

/** Icon + tint for an account row (unknown kinds fall back to a neutral box). */
export function accountAppearance(account: AccountWithBalance): {
  iconId: AccountIconName;
  tone: string;
  kindKey: TranslationKey | null;
  color: string;
} {
  const kind = asAccountKind(account.account_kind);
  if (!kind) {
    return {
      iconId: resolveAccountIconId(account.icon, account.account_kind),
      tone: 'bg-surface-hover text-muted-foreground',
      kindKey: null,
      color: 'rgb(var(--dim))',
    };
  }
  return {
    iconId: resolveAccountIconId(account.icon, kind),
    tone: KIND_TONES[kind],
    kindKey: KIND_LABEL_KEYS[kind],
    color: KIND_CHART_COLORS[kind],
  };
}

/** Balance-sheet accounts only; posting accounts stay in the Ledger. */
export function isBalanceSheet(account: AccountWithBalance): boolean {
  return account.type === 'asset' || account.type === 'liability';
}

/** Sum asset balances using the same signed values shown in account totals. */
export function totalAssetBalance(accounts: AccountWithBalance[]): number {
  return accounts.reduce(
    (total, account) =>
      total + (account.type === 'asset' ? parseFloat(account.balance) || 0 : 0),
    0,
  );
}

/** `true` when the account has a monthly billing cycle (a credit card). */
export function isCreditCard(account: AccountWithBalance): boolean {
  return account.type === 'liability' && !!account.closing_day && !!account.due_day;
}
