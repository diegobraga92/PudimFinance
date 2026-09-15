/**
 * Shared account icon mapping.
 *
 * Accounts store stable identifiers, not emoji. This keeps the API/offline
 * mirror portable while allowing each client to render a native icon.
 */
export const ACCOUNT_ICON_NAMES = [
  'bank',
  'money',
  'card',
  'loan',
  'trending-up',
  'wallet',
  'safe',
  'scale',
  'briefcase',
  'home',
  'more-horizontal',
] as const;

export type AccountIconName = (typeof ACCOUNT_ICON_NAMES)[number];

export const DEFAULT_ACCOUNT_ICON: Record<string, AccountIconName> = {
  bank: 'bank',
  cash: 'money',
  card: 'card',
  loan: 'loan',
  investment: 'trending-up',
  equity: 'scale',
  income: 'briefcase',
  expense: 'briefcase',
  other: 'more-horizontal',
};