import { invoke, isTauri } from '@tauri-apps/api/core';
import { getApiBaseUrl } from '@/lib/serverConfig';
import { notifyTransactionsChanged } from '@/lib/transaction-events';
import { logError, logEvent } from '@/lib/app-log';
import { nativeImportTransaction } from '@/notifications/capture';
import {
  getLocalTransactions,
  getPendingOperations,
  markAccountSynced,
  markCategorySynced,
  markTransactionSynced,
  recordPendingOperationFailure,
  removePendingOperation,
  upsertLocalTransaction,
} from './database';

export interface NativeSyncResult {
  client_id: string;
  status: string;
  server_id?: string;
  error?: string;
}

/** Configures WorkManager with the same server URL used by the web client. */
export async function configureNativeSync(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|set_sync_config', {
      baseUrl: await getApiBaseUrl(),
    });
  } catch (err) {
    // Desktop and older plugin versions safely ignore native configuration.
    logError('native', err, 'set_sync_config failed');
  }
}

/** Mirrors an IndexedDB operation into the encrypted Android outbox. */
export async function putNativeMutation(operation: {
  operation_type: string;
  entity_type: string;
  client_id: string;
  server_id: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|sync_outbox_put', {
      operationType: operation.operation_type,
      entityType: operation.entity_type,
      clientId: operation.client_id,
      serverId: operation.server_id,
      payloadJson: JSON.stringify(operation.payload),
    });
  } catch (err) {
    // The IndexedDB outbox remains authoritative if native storage is unavailable.
    logError('native', err, 'sync_outbox_put failed');
  }
}

async function drainNativeSyncResults(): Promise<NativeSyncResult[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<NativeSyncResult[]>('plugin:pudim-native|drain_sync_results');
  } catch (err) {
    logError('native', err, 'drain_sync_results failed');
    return [];
  }
}

export async function clearNativeSyncOutbox(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|clear_sync_outbox');
  } catch (err) {
    // Logout must still complete if the native plugin is unavailable.
    logError('native', err, 'clear_sync_outbox failed');
  }
}

export async function removeNativeMutation(clientId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|sync_outbox_remove', { clientId });
  } catch (err) {
    // The native worker will safely retry an idempotent operation if needed.
    logError('native', err, 'sync_outbox_remove failed');
  }
}

/**
 * Transaction fields the native worker uploaded while the WebView was asleep.
 * Mirrors the payload of a `native_import` capture event.
 */
export interface NativeImportEntry {
  client_id: string;
  type?: string;
  amount?: string;
  description?: string;
  date?: string;
  category_id?: string | null;
  account_id?: string | null;
  notes?: string | null;
}

/**
 * Mirrors a transaction the native worker created for a capture that never
 * reached the WebView (the app was closed when the prompt was tapped).
 *
 * The native outbox already owns the upload, so only the local row is written
 * here. Reusing the native `client_id` keeps repeated drains idempotent, and
 * the row stays marked as not-yet-synced until the worker's result arrives.
 */
export async function adoptNativeTransaction(entry: NativeImportEntry): Promise<boolean> {
  const parsed = nativeImportTransaction(entry);
  if (!parsed) return false;
  const existing = (await getLocalTransactions()).find((row) => row.id === entry.client_id);
  if (existing) return true;
  await upsertLocalTransaction({
    id: entry.client_id,
    server_id: null,
    description: parsed.description,
    amount: parsed.amount,
    type: parsed.type,
    category_id: parsed.categoryId,
    date: parsed.date,
    notes: entry.notes ?? null,
    installment_plan_id: null,
    account_id: entry.account_id ?? null,
    synced: 0,
    updated_at: new Date().toISOString(),
  });
  notifyTransactionsChanged();
  return true;
}

/** Applies closed-app worker results to the IndexedDB mirror. */
export async function reconcileNativeSyncResults(): Promise<void> {
  const results = await drainNativeSyncResults();
  if (results.length === 0) return;
  const pending = await getPendingOperations();
  const byClientId = new Map(pending.map((operation) => [operation.local_id ?? operation.server_id, operation]));
  for (const result of results) {
    const operation = byClientId.get(result.client_id);
    if (!operation) {
      // A capture imported natively has no IndexedDB outbox row, so settle its
      // local mirror directly. Failures keep the row pending (visible and
      // editable) and are logged instead of dropped silently.
      if (result.status === 'ok' && result.server_id) {
        await markTransactionSynced(result.client_id, result.server_id);
        notifyTransactionsChanged();
        logEvent('info', 'native', `native import ${result.client_id} synced as ${result.server_id}`);
      } else {
        logEvent(
          'error',
          'native',
          `native import ${result.client_id} rejected: ${result.error ?? result.status}`,
        );
      }
      continue;
    }
    if (result.status === 'ok') {
      if (result.server_id && operation.operation_type === 'create') {
        if (operation.entity_type === 'transaction') {
          await markTransactionSynced(operation.local_id ?? result.client_id, result.server_id);
        } else if (operation.entity_type === 'category') {
          await markCategorySynced(operation.local_id ?? result.client_id, result.server_id);
        } else if (operation.entity_type === 'account') {
          await markAccountSynced(operation.local_id ?? result.client_id, result.server_id);
        }
      }
      await removePendingOperation(operation.id);
    } else {
      await recordPendingOperationFailure(operation.id, result.error ?? `Sync ${result.status}`);
    }
  }
}