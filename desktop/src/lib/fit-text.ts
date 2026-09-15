/** Picks a readable font size that keeps a formatted amount inside a chart hole. */
export function fitTextSize(
  text: string,
  availableWidth: number,
  options: { min?: number; max?: number } = {},
): number {
  const min = options.min ?? 11;
  const max = options.max ?? 20;
  // Amounts contain digits, punctuation and a currency symbol. This conservative
  // average width avoids relying on a font-specific measurement during render.
  const estimatedWidth = Math.max(1, text.length) * 0.58;
  return Math.max(min, Math.min(max, availableWidth / estimatedWidth));
}