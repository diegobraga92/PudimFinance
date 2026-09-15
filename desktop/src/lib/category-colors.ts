import { CHART_COLORS } from './chart-colors';

/** The picker palette and chart fallback palette intentionally share colors. */
export const CATEGORY_COLORS = [
  '#22c55e', '#16a34a', '#15803d', '#a3e635', '#86efac',
  '#ef4444', '#dc2626', '#b91c1c', '#f97316', '#eab308',
  '#ec4899', '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4',
  '#14b8a6', '#84cc16', '#6b7280',
];

export function firstAvailableCategoryColor(categories: Array<{ color?: string | null }>): string {
  const used = new Set(
    categories
      .map((category) => category.color?.trim().toLowerCase())
      .filter((color): color is string => Boolean(color)),
  );
  return CATEGORY_COLORS.find((color) => !used.has(color.toLowerCase())) ?? CATEGORY_COLORS[0];
}

export interface ColoredItem {
  key: string;
  color?: string | null;
}

/**
 * Resolves one stable color per category key.
 *
 * Stored colors win only once. If old data contains duplicate stored colors,
 * the category with the lexicographically first key keeps it and the remaining
 * categories receive the first unused palette color. Sorting the assignment
 * order by key prevents chart sorting from changing a category's color.
 */
export function resolveCategoryColors(items: ColoredItem[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  const ordered = [...items].sort((a, b) => a.key.localeCompare(b.key));

  for (const item of ordered) {
    const stored = item.color?.trim().toLowerCase();
    if (stored && !used.has(stored)) {
      result.set(item.key, item.color!.trim());
      used.add(stored);
    }
  }

  let paletteIndex = 0;
  for (const item of ordered) {
    if (result.has(item.key)) continue;
    while (
      paletteIndex < CATEGORY_COLORS.length &&
      used.has(CATEGORY_COLORS[paletteIndex].toLowerCase())
    ) {
      paletteIndex += 1;
    }
    const fallback =
      paletteIndex < CATEGORY_COLORS.length
        ? CATEGORY_COLORS[paletteIndex++]
        : CHART_COLORS[result.size % CHART_COLORS.length];
    result.set(item.key, fallback);
    used.add(fallback.toLowerCase());
  }

  return result;
}