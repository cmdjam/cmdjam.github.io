// Persistence: IndexedDB `tessera-day` v1 with two stores.
//   meta: key "main" -> { version, settings, categories }
//   days: key "YYYY-MM-DD" -> { q, plan, actual }   (empty days are deleted, not stored)
// One record per day means a paint stroke rewrites only that day. If IndexedDB can't be
// opened (some private modes), the app runs in memory and says so.
import * as M from './model.js';

const DB = 'tessera-day', VERSION = 1;
let db = null;
let onError = e => console.error(e);
export const onWriteError = fn => { onError = fn; };
export const isPersistent = () => !!db;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('days')) d.createObjectStore('days');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

// Run fn(...objectStores) in one transaction; resolves with fn's return value on commit.
function run(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(...stores.map(s => t.objectStore(s)));
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const write = (stores, fn) => (db ? run(stores, 'readwrite', fn).catch(e => onError(e)) : Promise.resolve());

export async function load() {
  try {
    db = await openDB();
    const got = await run(['meta', 'days'], 'readonly', (meta, days) => {
      const o = { meta: null, days: {} };
      meta.get('main').onsuccess = e => { o.meta = e.target.result; };
      days.openCursor().onsuccess = e => {
        const c = e.target.result;
        if (c) { o.days[c.key] = c.value; c.continue(); }
      };
      return o;
    });
    if (!got.meta) {
      const data = M.starterData();
      await saveAll(data);
      return { data, fresh: true };
    }
    return { data: M.normalize({ ...got.meta, days: got.days }) };
  } catch (e) {
    console.warn('IndexedDB unavailable; running in memory.', e);
    db = null;
    return { data: M.starterData(), memoryOnly: true };
  }
}

const metaOf = d => ({ version: d.version, settings: d.settings, categories: d.categories });

export const saveMeta = data => write(['meta'], m => { m.put(metaOf(data), 'main'); });
export const saveDay = (key, day) => write(['days'], d => { if (day) d.put(day, key); else d.delete(key); });
export const saveAll = data => write(['meta', 'days'], (m, d) => {
  m.put(metaOf(data), 'main');
  d.clear();
  for (const [k, v] of Object.entries(data.days)) d.put(v, k);
});

// Ask the browser not to evict our data under storage pressure (granted silently for installed PWAs).
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}

// ---------- JSON export / import ----------

export function exportJSON(data) {
  return JSON.stringify({ format: 'tessera-day', exportedAt: new Date().toISOString(), ...metaOf(data), days: data.days });
}

export function parseImport(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!o || typeof o !== 'object' || (o.format !== 'tessera-day' && !Array.isArray(o.categories))) {
    throw new Error("That file isn't a Tessera Day export.");
  }
  return M.normalize(o);
}
