type TransactionChangeListener = () => void;

const listeners = new Set<TransactionChangeListener>();

export function notifyTransactionsChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Observers must never interrupt a successful mutation.
    }
  }
}

export function subscribeTransactionsChanged(listener: TransactionChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}