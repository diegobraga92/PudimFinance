/** Shared category icon identifiers and legacy emoji mapping. */

/** Canonical icon identifiers offered in the category pickers. */
export const CATEGORY_ICON_NAMES: string[] = [
  'briefcase', 'laptop', 'trending-up', 'gift', 'plus-circle',
  'shopping-cart', 'home', 'car', 'zap', 'film', 'heart', 'book',
  'shopping-bag', 'plane', 'repeat', 'shield', 'more-horizontal',
];

/** @deprecated Use the desktop `CategoryIcon` component. */
export const CATEGORY_ICON_EMOJI: Record<string, string> = {
  briefcase: '💼',
  laptop: '💻',
  'trending-up': '📈',
  gift: '🎁',
  'plus-circle': '➕',
  'shopping-cart': '🛒',
  home: '🏠',
  car: '🚗',
  zap: '⚡',
  film: '🎬',
  heart: '❤️',
  book: '📚',
  'shopping-bag': '🛍️',
  plane: '✈️',
  repeat: '🔁',
  shield: '🛡️',
  'more-horizontal': '📦',
};

/** Fallback glyph for unknown or missing icon identifiers. */
const FALLBACK_ICON = '•';

/** @deprecated Use the desktop `CategoryIcon` component for new UI. */
export function categoryIcon(name?: string | null): string {
  if (!name) return FALLBACK_ICON;
  return CATEGORY_ICON_EMOJI[name] ?? FALLBACK_ICON;
}
