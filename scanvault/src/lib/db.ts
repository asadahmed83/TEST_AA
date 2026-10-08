/** Minimal promise wrapper around IndexedDB. Values in the vault stores are ciphertext only. */

const DB_NAME = 'scanvault';
const DB_VERSION = 1;
export type StoreName = 'meta' | 'content' | 'chats' | 'mockcloud';
const STORES: StoreName[] = ['meta', 'content', 'chats', 'mockcloud'];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store: StoreName, mode: IDBTransactionMode) {
  return (await open()).transaction(store, mode).objectStore(store);
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return wrap((await tx(store, 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function dbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  await wrap((await tx(store, 'readwrite')).put(value, key));
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  await wrap((await tx(store, 'readwrite')).delete(key));
}

export async function dbEntries<T>(store: StoreName): Promise<[string, T][]> {
  const s = await tx(store, 'readonly');
  const [keys, values] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
  return keys.map((k, i) => [String(k), values[i] as T]);
}

export async function dbClear(store: StoreName): Promise<void> {
  await wrap((await tx(store, 'readwrite')).clear());
}
