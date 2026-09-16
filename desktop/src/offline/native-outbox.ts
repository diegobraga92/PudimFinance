import { invoke } from '@tauri-apps/api/core';
import { getApiBaseUrl } from '@/lib/serverConfig';
import {
  getPendingOperations,
  markAccountSynced,
  markCategorySynced,
  markTransactionSynced,
  recordPendingOperationFailure,
  removePendingOperation,
} from './database';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

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
  } catch {
    // Desktop and older plugin versions safely ignore native configuration.
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
  } catch {
    // The IndexedDB outbox remains authoritative if native storage is unavailable.
  }
}

export async function drainNativeSyncResults(): Promise<NativeSyncResult[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<NativeSyncResult[]>('plugin:pudim-native|drain_sync_results');
  } catch {
    return [];
  }
}

export async function clearNativeSyncOutbox(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|clear_sync_outbox');
  } catch {
    // Logout must still complete if the native plugin is unavailable.
  }
}

export async function removeNativeMutation(clientId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|sync_outbox_remove', { clientId });
  } catch {
    // The native worker will safely retry an idempotent operation if needed.
  }
}

/** Applies closed-app worker results to the IndexedDB mirror. */
export async function reconcileNativeSyncResults(): Promise<void> {
  const results = await drainNativeSyncResults();
  if (results.length === 0) return;
  const pending = await getPendingOperations();
  const byClientId = new Map(pending.map((operation) => [operation.local_id ?? operation.server_id, operation]));
  for (const result of results) {
    const operation = byClientId.get(result.client_id);
    if (!operation) continue;
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