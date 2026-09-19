/** Coordinates queued mutations, server pulls, and the local mirror. */

import { syncPull, syncPush, type SyncPushOperation } from '@/lib/sync-api';
import { notifyTransactionsChanged } from '@/lib/transaction-events';
import {
  addPendingOperation,
  countPendingOperations,
  countSyncableOperations,
  deleteLocalAccount,
  deleteLocalCategory,
  deleteLocalTransaction,
  getLastSync,
  getLocalAccounts,
  getLocalCategories,
  getLocalTransactions,
  getFailedPendingOperations,
  getPendingOperations,
  isOperationFailed,
  markAccountSynced,
  markCategorySynced,
  markTransactionSynced,
  removePendingOperation,
  recordPendingOperationFailure,
  resetPendingOperationFailures,
  replaceLocalAccounts,
  replaceLocalCategories,
  replaceLocalTransactions,
  saveLastSync,
  type LocalAccount,
  type LocalCategory,
  type LocalTransaction,
  type PendingOperation,
} from './database';
import { isOnline, uuid } from './net';
import { putNativeMutation, reconcileNativeSyncResults, removeNativeMutation } from './native-outbox';

export interface SyncResult {
  pushed: number;
  pulledTransactions: number;
  pulledCategories: number;
  failed: number;
  firstError?: string;
  ok: boolean;
  error?: string;
}

/** Deduplicates concurrent syncs so a single pass is shared by all callers. */
let syncInFlight: Promise<SyncResult> | null = null;

type SyncListener = (result: SyncResult) => void;
const syncListeners = new Set<SyncListener>();

/** Registers a callback fired after every completed sync (push and pull). */
export function subscribeSync(cb: SyncListener): () => void {
  syncListeners.add(cb);
  return () => {
    syncListeners.delete(cb);
  };
}

function notifySyncListeners(result: SyncResult): void {
  for (const cb of syncListeners) {
    try {
      cb(result);
    } catch {
      // Listener errors must never break the sync pipeline.
    }
  }
}

async function performSync(): Promise<SyncResult> {
  await reconcileNativeSyncResults();
  const online = await isOnline();
  if (!online) {
    return {
      pushed: 0,
      pulledTransactions: 0,
      pulledCategories: 0,
      failed: 0,
      ok: false,
      error: 'offline',
    };
  }

  try {
    const push = await pushPending();
    const pulled = await pullChanges();
    const failedOperations = await getFailedPendingOperations();
    const firstError = push.firstError ?? failedOperations[0]?.last_error ?? undefined;
    return {
      pushed: push.pushed,
      pulledTransactions: pulled.transactions.length,
      pulledCategories: pulled.categories.length,
      failed: Math.max(push.failed, failedOperations.length),
      firstError,
      ok: push.failed === 0 && failedOperations.length === 0,
    };
  } catch (err) {
    // A transport/server failure must not reject the shared sync promise: the
    // queued changes stay put and the caller keeps a countable result.
    const message = err instanceof Error ? err.message : String(err);
    return {
      pushed: 0,
      pulledTransactions: 0,
      pulledCategories: 0,
      failed: 0,
      firstError: message,
      ok: false,
      error: message,
    };
  }
}

function performSyncWithLock(): Promise<SyncResult> {
  if (!syncInFlight) {
    syncInFlight = performSync().finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

/** Pushes pending operations and pulls remote changes, then notifies subscribers. */
export async function syncAll(): Promise<SyncResult> {
  const result = await performSyncWithLock();
  notifySyncListeners(result);
  return result;
}

/** Resets bounded failures and immediately performs a user-requested retry. */
export async function retryFailedOperations(): Promise<SyncResult> {
  await resetPendingOperationFailures();
  return syncAll();
}

/** Syncs without notifying subscribers (used by loaders that refresh themselves). */
export async function syncSilently(): Promise<SyncResult> {
  return performSyncWithLock();
}

interface PushResult {
  pushed: number;
  failed: number;
  firstError?: string;
}

async function pushBatch(
  pending: Awaited<ReturnType<typeof getPendingOperations>>,
): Promise<PushResult> {
  if (pending.length === 0) return { pushed: 0, failed: 0 };

  const operations: SyncPushOperation[] = pending.map((op) => ({
    operation_type: op.operation_type,
    entity_type: op.entity_type,
    client_id: op.local_id ?? op.server_id ?? uuid(),
    server_id: op.server_id ?? undefined,
    payload: op.payload ? JSON.parse(op.payload) : {},
  }));

  const res = await syncPush(operations);

  // Drop only the acknowledged operations. Failed ones (conflict/error) stay
  // queued so a later sync retries them instead of silently losing the change.
  let pushed = 0;
  let failed = 0;
  let firstError: string | undefined;
  const pendingById = new Map(pending.map((op) => [op.local_id ?? op.server_id, op]));
  for (const result of res.results) {
    const op = pendingById.get(result.client_id);
    if (!op) continue;
    if (result.status !== 'ok') {
      failed += 1;
      const error = result.error ?? `Sync ${result.status}`;
      firstError ??= error;
      await recordPendingOperationFailure(op.id, error);
      await removeNativeMutation(result.client_id);
      continue;
    }
    pushed += 1;
    // A create returned a server-assigned id, so remap the local row to keep the
    // mirror consistent (the server stores client_id as the idempotency key).
    if (result.server_id && op.operation_type === 'create') {
      if (op.entity_type === 'transaction') {
        await markTransactionSynced(op.local_id ?? result.client_id, result.server_id);
      } else if (op.entity_type === 'category') {
        await markCategorySynced(op.local_id ?? result.client_id, result.server_id);
      } else if (op.entity_type === 'account') {
        await markAccountSynced(op.local_id ?? result.client_id, result.server_id);
      }
    }
    await removePendingOperation(op.id);
    await removeNativeMutation(result.client_id);
  }
  return { pushed, failed, firstError };
}

/** Sends creates before updates/deletes so offline-created parents exist first. */
async function pushPending(): Promise<PushResult> {
  // Failed operations stay queued until the user retries or discards them, so a
  // permanently rejected change cannot keep every sync pass busy.
  const pending = (await getPendingOperations()).filter((op) => !isOperationFailed(op));
  if (pending.length === 0) return { pushed: 0, failed: 0 };

  const creates = pending.filter((op) => op.operation_type === 'create');
  const rest = pending.filter((op) => op.operation_type !== 'create');
  const createResult = await pushBatch(creates);
  if (createResult.failed > 0) return createResult;
  const restResult = await pushBatch(rest);
  return {
    pushed: createResult.pushed + restResult.pushed,
    failed: restResult.failed,
    firstError: restResult.firstError,
  };
}

/** Pulls server changes since the last sync into the local mirror. */
async function pullChanges(): Promise<{
  transactions: LocalTransaction[];
  categories: LocalCategory[];
  accounts: LocalAccount[];
}> {
  const lastSyncedAt = (await getLastSync()) ?? '1970-01-01T00:00:00Z';
  const res = await syncPull(lastSyncedAt);

  // Merge pulled transaction rows without clobbering unsynced local rows.
  const byId = new Map<string, LocalTransaction>();
  const local = await getLocalTransactions();
  for (const txRow of local) {
    if (txRow.synced === 0) {
      byId.set(txRow.id, txRow); // keep local-only rows
    } else if (txRow.server_id) {
      byId.set(txRow.server_id, txRow);
    } else {
      byId.set(txRow.id, txRow);
    }
  }
  for (const t of res.transactions) {
    byId.set(t.id, {
      id: t.id,
      server_id: t.id,
      description: t.description,
      amount: t.amount,
      type: t.type as LocalTransaction['type'],
      category_id: t.category_id ?? null,
      date: t.date,
      notes: t.notes ?? null,
      installment_plan_id: t.installment_plan_id ?? null,
      account_id: t.account_id ?? null,
      synced: 1,
      updated_at: t.updated_at,
    });
  }
  await replaceLocalTransactions(Array.from(byId.values()));

  // Merge pulled category rows without clobbering unsynced local rows.
  const categoryById = new Map<string, LocalCategory>();
  for (const c of await getLocalCategories()) {
    if (c.synced === 0) {
      categoryById.set(c.id, c);
    } else if (c.server_id) {
      categoryById.set(c.server_id, c);
    } else {
      categoryById.set(c.id, c);
    }
  }
  for (const c of res.categories) {
    categoryById.set(c.id, {
      id: c.id,
      server_id: c.id,
      name: c.name,
      type: c.type,
      parent_id: c.parent_id ?? null,
      icon: c.icon ?? null,
      color: c.color ?? null,
      synced: 1,
      updated_at: c.updated_at,
    });
  }
  await replaceLocalCategories(Array.from(categoryById.values()));

  // Merge pulled account rows without clobbering unsynced local rows.
  const accountById = new Map<string, LocalAccount>();
  for (const acc of await getLocalAccounts()) {
    if (acc.synced === 0) {
      accountById.set(acc.id, acc);
    } else if (acc.server_id) {
      accountById.set(acc.server_id, acc);
    } else {
      accountById.set(acc.id, acc);
    }
  }
  for (const a of res.accounts) {
    accountById.set(a.id, {
      id: a.id,
      server_id: a.id,
      name: a.name,
      type: a.type,
      account_kind: a.account_kind,
      icon: a.icon ?? null,
      parent_id: a.parent_id ?? null,
      closing_day: a.closing_day ?? null,
      due_day: a.due_day ?? null,
      credit_limit: a.credit_limit ?? null,
      balance: a.balance,
      transaction_count: a.transaction_count ?? 0,
      created_at: a.created_at,
      // The sync pull response has no `updated_at` for accounts. The mirror only
      // needs a monotonic timestamp, so created_at is a safe proxy.
      updated_at: a.created_at,
      synced: 1,
    });
  }
  await replaceLocalAccounts(Array.from(accountById.values()));

  await saveLastSync(res.server_time);

  return {
    transactions: await getLocalTransactions(),
    categories: await getLocalCategories(),
    accounts: await getLocalAccounts(),
  };
}

/** Queues a mutation and immediately updates the local mirror. */
export async function queueLocalMutation(
  operationType: 'create' | 'update' | 'delete',
  entityType: 'transaction' | 'category' | 'account',
  localId: string,
  serverId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await addPendingOperation({
    operation_type: operationType,
    entity_type: entityType,
    local_id: localId,
    server_id: serverId,
    payload: JSON.stringify(payload),
  });
  await putNativeMutation({
    operation_type: operationType,
    entity_type: entityType,
    client_id: localId,
    server_id: serverId,
    payload,
  });
}

/**
 * Abandons queued operations the user chose to discard.
 *
 * Creates never reached the server, so their local row is deleted with them;
 * updates/deletes are re-marked as synced so the next pull restores the server
 * state. The mirrored native operation is removed too, otherwise WorkManager
 * would still upload it while the app is closed.
 *
 * Returns the number of discarded operations.
 */
export async function discardPendingOperations(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const wanted = new Set(ids);
  const operations = (await getPendingOperations()).filter((op) => wanted.has(op.id));
  let touchedTransactions = false;
  for (const op of operations) {
    await removePendingOperation(op.id);
    const clientId = op.local_id ?? op.server_id;
    if (clientId) await removeNativeMutation(clientId);
    if (op.operation_type === 'create') {
      await deleteDiscardedLocalRow(op);
    } else if (op.operation_type === 'update') {
      // Keep the local row but treat it as settled; the next pull overwrites it.
      await markDiscardedRowSynced(op);
    }
    if (op.entity_type === 'transaction') touchedTransactions = true;
  }
  if (touchedTransactions) notifyTransactionsChanged();
  return operations.length;
}

/** Removes the local mirror row of a discarded create. */
async function deleteDiscardedLocalRow(op: PendingOperation): Promise<void> {
  if (!op.local_id) return;
  if (op.entity_type === 'transaction') await deleteLocalTransaction(op.local_id);
  else if (op.entity_type === 'category') await deleteLocalCategory(op.local_id);
  else await deleteLocalAccount(op.local_id);
}

/** Re-marks an unsynced row as settled after its update was discarded. */
async function markDiscardedRowSynced(op: PendingOperation): Promise<void> {
  if (!op.server_id) return;
  const localId = op.local_id ?? op.server_id;
  if (op.entity_type === 'transaction') await markTransactionSynced(localId, op.server_id);
  else if (op.entity_type === 'category') await markCategorySynced(localId, op.server_id);
  else await markAccountSynced(localId, op.server_id);
}

export {
  countPendingOperations,
  countSyncableOperations,
  getFailedPendingOperations,
  getLocalAccounts,
  getLocalCategories,
  getLocalTransactions,
  getPendingOperations,
  isOnline,
};

export type { PendingOperation };

/** Register the pending-count callback for UI indicators. */
export function subscribePendingCount(cb: (count: number) => void): () => void {
  let active = true;
  const poll = () => {
    if (!active) return;
    void countPendingOperations().then((count) => {
      if (active) cb(count);
    });
  };
  poll();
  // Simple interval-based polling. The count is cheap.
  const interval = setInterval(poll, 2000);
  return () => {
    active = false;
    clearInterval(interval);
  };
}

