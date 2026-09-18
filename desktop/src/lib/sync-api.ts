import type { components } from './api-types';
import { request } from './request';

/** Transport helpers for the offline sync endpoints. */

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
    timeoutMs: 30_000,
  });
}

/** Pushes a batch of client mutations. */
export async function syncPush(operations: SyncPushOperation[]): Promise<SyncPushResponse> {
  return request<SyncPushResponse>('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ operations } satisfies SyncPushRequest),
    timeoutMs: 30_000,
  });
}
