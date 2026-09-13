import type { components } from './api-types';
import { request } from './request';

/**
 * Raw transport for the offline sync endpoints.
 *
 * Extracted from `api.ts` so the sync engine (`offline/sync-engine.ts`) never
 * imports the app API layer, which keeps the dependency graph acyclic.
 */

export type SyncPullRequest = components['schemas']['SyncPullRequest'];
export type SyncPullResponse = components['schemas']['SyncPullResponse'];
export type SyncPushRequest = components['schemas']['SyncPushRequest'];
export type SyncPushResponse = components['schemas']['SyncPushResponse'];

export interface SyncPushOperation {
  operation_type: 'create' | 'update' | 'delete';
  entity_type: 'transaction' | 'category' | 'account';
  client_id: string;
  server_id?: string;
  payload: Record<string, unknown>;
}

/** Pulls entities changed since the given timestamp. */
export async function syncPull(lastSyncedAt: string): Promise<SyncPullResponse> {
  return request<SyncPullResponse>('/api/sync/pull', {
    method: 'POST',
    body: JSON.stringify({ last_synced_at: lastSyncedAt } satisfies SyncPullRequest),
  });
}

/** Pushes a batch of client mutations. */
export async function syncPush(operations: SyncPushOperation[]): Promise<SyncPushResponse> {
  return request<SyncPushResponse>('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ operations } satisfies SyncPushRequest),
  });
}
