/** IndexedDB mirror and mutation queue used by the offline-first client. */

const DB_NAME = 'pudimfinance.db';
const DB_VERSION = 1;

export interface LocalTransaction {
  /** Local row id, a client-generated UUID. */
  id: string;
  /** Server UUID once the row has been pushed (NULL until then). */
  server_id: string | null;
  description: string;
  amount: string;
  type: 'income' | 'expense';
  category_id: string | null;
  date: string;
  notes: string | null;
  installment_plan_id: string | null;
  account_id: string | null;
  /** 0 = local-only (pending push), 1 = synced to server. */
  synced: number;
  updated_at: string;
}

export interface LocalCategory {
  id: string;
  server_id: string | null;
  name: string;
  type: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  synced: number;
  updated_at: string;
}

export interface LocalAccount {
  id: string;
  server_id: string | null;
  name: string;
  type: string;
  account_kind: string;
  icon: string | null;
  parent_id: string | null;
  closing_day: number | null;
  due_day: number | null;
  credit_limit: string | null;
  balance: string;
  transaction_count: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface PendingOperation {
  id: number;
  operation_type: 'create' | 'update' | 'delete';
  entity_type: 'transaction' | 'category' | 'account';
  /** Client UUID for creates / local row id. */
  local_id: string | null;
  /** Server UUID for updates/deletes. */
  server_id: string | null;
  /** JSON request body for create/update. */
  payload: string;
  created_at: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('local_transactions')) {
          db.createObjectStore('local_transactions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('local_categories')) {
          db.createObjectStore('local_categories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('local_accounts')) {
          db.createObjectStore('local_accounts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pending_operations')) {
          db.createObjectStore('pending_operations', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('sync_metadata')) {
          db.createObjectStore('sync_metadata', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  // lib.dom's IDBRequest<T> is invariant, so the callers' concrete request
  // types (IDBRequest<IDBValidKey>, IDBRequest<T[]>, …) can't unify under one
  // generic parameter here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (store: IDBObjectStore) => IDBRequest<any> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result: T | undefined;
        let done = false;
        try {
          const req = fn(store);
          if (req) {
            req.onsuccess = () => {
              result = req.result as T;
            };
          }
        } catch (err) {
          reject(err);
          return;
        }
        transaction.oncomplete = () => {
          if (!done) {
            done = true;
            resolve(result);
          }
        };
        transaction.onerror = () => {
          if (!done) {
            done = true;
            reject(transaction.error);
          }
        };
        transaction.onabort = () => {
          if (!done) {
            done = true;
            reject(transaction.error ?? new Error('transaction aborted'));
          }
        };
      }),
  );
}

function getAll<T>(storeName: string): Promise<T[]> {
  return tx<T[]>(storeName, 'readonly', (store) => store.getAll()).then((rows) => rows ?? []);
}

function putAll<T>(storeName: string, items: T[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        for (const item of items) store.put(item as IDBValidKey);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

function clearAll(storeName: string): Promise<void> {
  return tx(storeName, 'readwrite', (store) => store.clear()).then(() => undefined);
}

export function isOfflineSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function getLocalTransactions(): Promise<LocalTransaction[]> {
  const rows = await getAll<LocalTransaction>('local_transactions');
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function getLocalTransactionById(id: string): Promise<LocalTransaction | null> {
  const all = await getLocalTransactions();
  return all.find((t) => t.id === id || t.server_id === id) ?? null;
}

export async function upsertLocalTransaction(txRow: LocalTransaction): Promise<void> {
  await tx('local_transactions', 'readwrite', (store) => store.put(txRow));
}

export async function deleteLocalTransaction(id: string): Promise<void> {
  const existing = await getLocalTransactionById(id);
  if (existing) {
    await tx('local_transactions', 'readwrite', (store) => store.delete(existing.id));
  }
}

export async function replaceLocalTransactions(transactions: LocalTransaction[]): Promise<void> {
  await clearAll('local_transactions');
  if (transactions.length > 0) await putAll('local_transactions', transactions);
}

export async function updateLocalTransactionFields(
  id: string,
  fields: Partial<Omit<LocalTransaction, 'id' | 'updated_at'>>,
): Promise<void> {
  const existing = await getLocalTransactionById(id);
  if (!existing) return;
  await upsertLocalTransaction({ ...existing, ...fields, updated_at: new Date().toISOString() });
}

export async function markTransactionSynced(localId: string, serverId: string): Promise<void> {
  const existing = await getLocalTransactionById(localId);
  if (!existing) return;
  await upsertLocalTransaction({ ...existing, server_id: serverId, synced: 1 });
}

export async function getLocalCategories(): Promise<LocalCategory[]> {
  const rows = await getAll<LocalCategory>('local_categories');
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertLocalCategory(category: LocalCategory): Promise<void> {
  await tx('local_categories', 'readwrite', (store) => store.put(category));
}

export async function deleteLocalCategory(id: string): Promise<void> {
  const existing = (await getLocalCategories()).find((c) => c.id === id || c.server_id === id);
  if (existing) {
    await tx('local_categories', 'readwrite', (store) => store.delete(existing.id));
  }
}

export async function replaceLocalCategories(categories: LocalCategory[]): Promise<void> {
  await clearAll('local_categories');
  if (categories.length > 0) await putAll('local_categories', categories);
}

export async function markCategorySynced(localId: string, serverId: string): Promise<void> {
  const existing = (await getLocalCategories()).find((c) => c.id === localId);
  if (!existing) return;
  await upsertLocalCategory({ ...existing, server_id: serverId, synced: 1 });
}

export async function getLocalAccounts(): Promise<LocalAccount[]> {
  const rows = await getAll<LocalAccount>('local_accounts');
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertLocalAccount(account: LocalAccount): Promise<void> {
  await tx('local_accounts', 'readwrite', (store) => store.put(account));
}

export async function deleteLocalAccount(id: string): Promise<void> {
  const existing = (await getLocalAccounts()).find((a) => a.id === id || a.server_id === id);
  if (existing) {
    await tx('local_accounts', 'readwrite', (store) => store.delete(existing.id));
  }
}

export async function addPendingOperation(op: Omit<PendingOperation, 'id' | 'created_at'>): Promise<void> {
  await tx('pending_operations', 'readwrite', (store) =>
    store.add({ ...op, created_at: new Date().toISOString() } as PendingOperation),
  );
}

export async function getPendingOperations(): Promise<PendingOperation[]> {
  const rows = await getAll<PendingOperation>('pending_operations');
  return rows.sort((a, b) => a.id - b.id);
}

export async function removePendingOperation(id: number): Promise<void> {
  await tx('pending_operations', 'readwrite', (store) => store.delete(id));
}

export async function clearPendingOperations(): Promise<void> {
  await clearAll('pending_operations');
}

export async function countPendingOperations(): Promise<number> {
  return (await getAll<PendingOperation>('pending_operations')).length;
}

// Sync metadata

export async function getLastSync(): Promise<string | null> {
  const rows = await getAll<{ key: string; value: string }>('sync_metadata');
  return rows.find((r) => r.key === 'last_synced_at')?.value ?? null;
}

export async function saveLastSync(timestamp: string): Promise<void> {
  await tx('sync_metadata', 'readwrite', (store) =>
    store.put({
      key: 'last_synced_at',
      value: timestamp,
    } as { key: string; value: string }),
  );
}

export async function replaceLocalAccounts(accounts: LocalAccount[]): Promise<void> {
  await clearAll('local_accounts');
  if (accounts.length > 0) await putAll('local_accounts', accounts);
}

export async function markAccountSynced(localId: string, serverId: string): Promise<void> {
  const existing = (await getLocalAccounts()).find((a) => a.id === localId);
  if (!existing) return;
  await upsertLocalAccount({ ...existing, server_id: serverId, synced: 1 });
}

