/**
 * Home-screen Quick Add widget sync (Android).
 *
 * Computes today's expense total and pushes it to the native widget so the
 * "Spent today" line stays fresh. No-ops on desktop (no widget exists there).
 */
import { fetchTransactions } from '@/lib/api';
import { setWidgetSpentToday } from '@/notifications/native';

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/** Recomputes and pushes today's expense total to the widget. */
export async function refreshWidgetSpentToday(): Promise<void> {
  const today = toIsoDate(new Date());
  try {
    const res = await fetchTransactions({
      type: 'expense',
      start_date: today,
      end_date: today,
      page_size: 200,
    });
    const total = res.items.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
    await setWidgetSpentToday(formatBRL(total));
  } catch {
    // Widget updates are best effort.
  }
}
