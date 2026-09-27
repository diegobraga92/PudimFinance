/**
 * Offline mirror identity smoke test.
 * Run with: npx tsx --tsconfig=tsconfig.app.json scripts/category-mirror-smoke.ts
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

import { fetchCategories, fetchTransactions } from '../src/lib/api';
import { markServerUnavailable } from '../src/offline/net';
import {
  getLocalCategories,
  getLocalTransactions,
  markCategorySynced,
  markTransactionSynced,
  replaceLocalCategories,
  replaceLocalTransactions,
  upsertLocalCategory,
  upsertLocalTransaction,
  type LocalCategory,
  type LocalTransaction,
} from '../src/offline/database';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

const now = '2026-01-01T00:00:00.000Z';

function category(id: string, serverId: string | null, synced: number): LocalCategory {
  return {
    id,
    server_id: serverId,
    name: 'Mercado',
    type: 'expense',
    parent_id: null,
    icon: 'shopping-cart',
    color: null,
    synced,
    updated_at: now,
  };
}

function transaction(id: string, serverId: string | null, synced: number): LocalTransaction {
  return {
    id,
    server_id: serverId,
    description: 'Offline duplicate probe',
    amount: '10.00',
    type: 'expense',
    category_id: null,
    date: '2026-01-01',
    notes: null,
    installment_plan_id: null,
    account_id: null,
    synced,
    updated_at: now,
  };
}

/**
 * Writes a row straight into the store, reproducing what the old code left
 * behind. The mirror has to be open already, otherwise the store is missing.
 */
async function injectLegacyRow(
  storeName: 'local_categories' | 'local_transactions',
  row: object,
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pudimfinance.db');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!db.objectStoreNames.contains(storeName)) {
    db.close();
    throw new Error(`store ${storeName} is missing; open the mirror first`);
  }
  await new Promise<void>((resolve, reject) => {
    const write = db.transaction(storeName, 'readwrite');
    write.objectStore(storeName).put(row);
    write.oncomplete = () => resolve();
    write.onerror = () => reject(write.error);
    write.onabort = () => reject(write.error);
  });
  db.close();
}

async function main(): Promise<void> {
  // The mirror must exist before raw rows can be injected into it.
  await replaceLocalCategories([]);
  await replaceLocalTransactions([]);

  // 1. An offline create is pushed: the row keeps its local UUID and gains the
  //    server id (the server reuses the client id as the row id).
  await upsertLocalCategory(category('local-cat', null, 0));
  await markCategorySynced('local-cat', 'server-cat');
  const pushed = await getLocalCategories();
  assert(pushed.length === 1, 'a pushed category stays a single mirror row');
  assert(
    pushed[0].id === 'local-cat' && pushed[0].server_id === 'server-cat',
    'marking synced keeps the local key and stores the server id',
  );

  // 2. A later online edit used to write a second row keyed by the server UUID.
  await upsertLocalCategory(category('server-cat', 'server-cat', 1));
  const afterEdit = await getLocalCategories();
  assert(afterEdit.length === 1, 'an online edit does not add a second row for a synced category');
  assert(afterEdit[0].id === 'local-cat', 'the server-keyed write reuses the existing row key');

  // 3. Mirrors already broken by the old code still render one entry.
  await injectLegacyRow('local_categories', category('server-cat', 'server-cat', 1));
  assert((await getLocalCategories()).length === 2, 'legacy duplicate injected for the read-path check');
  markServerUnavailable(60_000);
  const offlineCategories = await fetchCategories();
  assert(
    offlineCategories.filter((item) => item.name === 'Mercado').length === 1,
    'the offline picker lists a legacy-duplicated category once',
  );

  // 4. A later sync settles the legacy pair into one row.
  await markCategorySynced('local-cat', 'server-cat');
  assert((await getLocalCategories()).length === 1, 'marking synced drops the duplicate server-keyed row');

  // 5. Transactions follow the same rule.
  await upsertLocalTransaction(transaction('local-tx', null, 0));
  await markTransactionSynced('local-tx', 'server-tx');
  await upsertLocalTransaction(transaction('server-tx', 'server-tx', 1));
  assert(
    (await getLocalTransactions()).length === 1,
    'an online edit does not duplicate a synced transaction',
  );

  await injectLegacyRow('local_transactions', transaction('server-tx', 'server-tx', 1));
  const offlineTransactions = await fetchTransactions({ page: 0, page_size: 50 });
  assert(
    offlineTransactions.items.length === 1,
    'the offline ledger lists a legacy-duplicated transaction once',
  );

  console.log('All mirror identity checks passed.');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
