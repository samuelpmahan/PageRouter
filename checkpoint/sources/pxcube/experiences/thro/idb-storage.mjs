// Where the editor's archive lives. Kept graphics hold their exact pixels, so the archive outgrew localStorage's few
// megabytes: the 25th Keep failed to save and every later change was refused until reload (Sam, 30 Oct: "A cap is
// unnecessary"). IndexedDB holds the same packed string under the same key, with room for far more.
// getItem and setItem answer with promises; locked-storage.mjs awaits both inside its lock, so another tab's write is
// still seen as a conflict. An archive saved before this change is read from localStorage until the first save here.
const DB = 'thro', STORE = 'archives';

function request(r) { return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
function done(tx) { return new Promise((ok, no) => { tx.oncomplete = () => ok(); tx.onerror = () => no(tx.error); tx.onabort = () => no(tx.error ?? Error('The save was aborted.')); }); }

export async function openIdbStorage({ indexedDB = globalThis.indexedDB, legacy = globalThis.localStorage } = {}) {
  if (!indexedDB) throw Error('IndexedDB is unavailable.');
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
  const db = await request(open);
  const legacyItem = key => { try { return legacy?.getItem(key) ?? null; } catch { return null; } };
  return Object.freeze({
    async getItem(key) {
      const value = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
      return value === undefined ? legacyItem(key) : value;
    },
    async setItem(key, value) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      await done(tx);
    },
    async removeItem(key) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await done(tx);
      try { legacy?.removeItem(key); } catch { /* nothing left there to remove */ }
    },
  });
}

/** The archive storage for this page: IndexedDB when the browser has it, localStorage otherwise (a private window may refuse IndexedDB). */
export async function archiveStorage() {
  try { return await openIdbStorage(); } catch { return globalThis.localStorage; }
}
