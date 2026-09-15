/**
 * Shared account icon mapping.
 *
 * Accounts store stable identifiers, not emoji. This keeps the API/offline
 * mirror portable while allowing each client to render a friendly glyph.
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

export const ACCOUNT_ICON_EMOJI: Record<string, string> = {
  bank: '🏦',
  money: '💵',
  card: '💳',
  loan: '🏛️',
  'trending-up': '📈',
  wallet: '👛',
  safe: '🔐',
  scale: '⚖️',
  briefcase: '💼',
  home: '🏠',
  'more-horizontal': '📦',
};

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

export function accountIcon(name?: string | null, kind?: string | null): string {
  const identifier = name ?? (kind ? DEFAULT_ACCOUNT_ICON[kind] : undefined);
  return ACCOUNT_ICON_EMOJI[identifier ?? ''] ?? ACCOUNT_ICON_EMOJI['more-horizontal'];
}