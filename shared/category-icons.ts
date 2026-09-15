/**
 * Shared category icon mapping.
 *
 * Categories store a stable icon *identifier* (a Feather-style name, e.g.
 * 'briefcase' or 'shopping-cart') in the database. Both the web and mobile
 * apps resolve those identifiers to a display emoji through this module, so
 * the stored value never changes and rendering is consistent everywhere.
 */

/** Canonical icon identifiers offered in the category pickers. */
export const CATEGORY_ICON_NAMES: string[] = [
  'briefcase', 'laptop', 'trending-up', 'gift', 'plus-circle',
  'shopping-cart', 'home', 'car', 'zap', 'film', 'heart', 'book',
  'shopping-bag', 'plane', 'repeat', 'shield', 'more-horizontal',
];

/**
 * @deprecated Desktop rendering uses Lucide icons from `CategoryIcon.tsx`.
 * Kept for compatibility with older shared clients.
 */
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
