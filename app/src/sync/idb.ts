// IndexedDB as the sync engine's storage on this device (sync/engine.ts; what it keeps there is encrypted)
import type { SyncStorage } from "./engine";

/** IndexedDB as the engine's storage (one small database for every warehouse and person on this device) */
export function idbStorage(): SyncStorage {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const q = indexedDB.open("wms-sync", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("kv");
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
  let db: Promise<IDBDatabase> | null = null;
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
    db ??= open();
    const store = (await db).transaction("kv", mode).objectStore("kv");
    return new Promise<T>((resolve, reject) => { const q = f(store); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  };
  return {
    get: key => run<string | undefined>("readonly", s => s.get(key) as IDBRequest<string | undefined>),
    set: async (key, value) => { await run("readwrite", s => s.put(value, key)); },
    del: async key => { await run("readwrite", s => s.delete(key)); },
  };
}
