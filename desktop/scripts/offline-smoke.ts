/**
 * Offline-layer smoke test (run with `npx tsx --tsconfig=tsconfig.app.json scripts/offline-smoke.ts`).
 *
 * Requires a PudimFinance backend on http://localhost:3000 with a reachable
 * Postgres (for example `docker compose up postgres` and the backend binary).
 *
 * Exercises the real IndexedDB wrapper (via fake-indexeddb) and the sync
 * engine through the app's offline-first API layer. Go "offline" (circuit
 * breaker), create a transaction (queued and mirrored), reconnect, sync, verify.
 */
import 'fake-indexeddb/auto';

// Minimal localStorage shim (auth and server config read it).
const lsStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsStore.set(k, v);
  },
  removeItem: (k: string) => {
    lsStore.delete(k);
  },
  clear: () => lsStore.clear(),
  key: (i: number) => Array.from(lsStore.keys())[i] ?? null,
  get length() {
    return lsStore.size;
  },
};

import {
  createTransaction,
  deleteTransaction,
  fetchTransactions,
  registerUser,
  updateTransaction,
} from '../src/lib/api';
import { setAuthSession } from '../src/lib/auth';
import { syncAll, syncSilently } from '../src/offline/sync-engine';
import {
  clearServerProbeCache,
  markServerUnavailable,
} from '../src/offline/net';
import { countPendingOperations, getLocalTransactions } from '../src/offline/database';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

async function main(): Promise<void> {
  const email = `offline${Date.now()}@test.dev`;
  const reg = await registerUser({ email, password: 'password123' });
  await setAuthSession(reg.access_token, reg.refresh_token, reg.user);
  console.log('PASS: register + session');

  // 1. Initial pull. The mirror reflects everything on the server.
  const initial = await syncSilently();
  assert(initial.ok, 'initial syncSilently ok');
  const serverCount = (await fetchTransactions({ page: 0, page_size: 200 })).items.length;
  assert(
    (await getLocalTransactions()).length === serverCount,
    `mirror matches server after pull (${serverCount})`,
  );

  const tag = String(Date.now());
  const descCreate = `Offline Created ${tag}`;

  // 2. Simulate offline. The circuit breaker opens, so creates queue and mirror.
  markServerUnavailable();
  const created = await createTransaction({
    description: descCreate,
    amount: '25.00',
    type: 'expense',
    date: new Date().toISOString().slice(0, 10),
  });
  assert((await countPendingOperations()) === 1, 'offline create queued one op');
  assert(
    (await getLocalTransactions()).length === serverCount + 1,
    'optimistic mirror row present',
  );
  assert(created.description === descCreate, 'offline create returns optimistic tx');

  // 3. Reconnect and sync. The queued create reaches the server.
  clearServerProbeCache();
  const pushed = await syncAll();
  assert(pushed.ok && pushed.pushed === 1, 'syncAll pushed the queued create');
  assert((await countPendingOperations()) === 0, 'pending queue drained after push');

  const list = await fetchTransactions({ page: 0, page_size: 200 });
  const onlineId = list.items.find((t) => t.description === descCreate)?.id;
  assert(Boolean(onlineId), 'server has the offline-created transaction');
  assert(
    (await getLocalTransactions()).some((t) => t.description === descCreate),
    'mirror keeps the synced row',
  );

  // 4. Offline delete is queued, then reconnect and the server reflects the delete.
  markServerUnavailable();
  await deleteTransaction(onlineId!);
  assert((await countPendingOperations()) === 1, 'offline delete queued one op');
  clearServerProbeCache();
  const pushed2 = await syncAll();
  assert(pushed2.pushed === 1, 'syncAll pushed the queued delete');

  const list2 = await fetchTransactions({ page: 0, page_size: 200 });
  assert(
    !list2.items.some((t) => t.description === descCreate),
    'server reflects the offline delete',
  );

  // 5. Offline update is queued, then reconnect and the server reflects the edit.
  const descUpdate = `Offline Update ${tag}`;
  markServerUnavailable();
  await createTransaction({
    description: descUpdate,
    amount: '5.00',
    type: 'expense',
    date: new Date().toISOString().slice(0, 10),
  });
  clearServerProbeCache();
  await syncAll(); // push the create so we have a server id to update
  const list3 = await fetchTransactions({ page: 0, page_size: 200 });
  const updateId = list3.items.find((t) => t.description === descUpdate)!.id;

  markServerUnavailable();
  await updateTransaction(updateId, {
    description: `${descUpdate} Edited`,
    amount: '7.50',
    type: 'expense',
    date: new Date().toISOString().slice(0, 10),
  });
  assert((await countPendingOperations()) === 1, 'offline update queued one op');
  clearServerProbeCache();
  const pushed3 = await syncAll();
  assert(pushed3.pushed === 1, 'syncAll pushed the queued update');

  const list4 = await fetchTransactions({ page: 0, page_size: 200 });
  const updated = list4.items.find((t) => t.id === updateId);
  assert(
    updated?.description === `${descUpdate} Edited` && updated?.amount === '7.50',
    'server reflects the offline update',
  );

  console.log('ALL OFFLINE SMOKE CHECKS PASSED');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

