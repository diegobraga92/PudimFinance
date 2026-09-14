import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes with conflict resolution (shadcn-style helper). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a value as BRL, matching the existing web/mobile `formatMoney`. */
export function formatBRL(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(n)) return 'R$ 0,00';
  // Keep the symbol spaced from the digits, regardless of the active locale.
  const amount = Math.abs(n).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? '-' : ''}R$ ${amount}`;
}

/** Clamp a number between two bounds. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
