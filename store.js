// Local storage for the app: everything stays on this device, no server, works offline.
// Keeps the same small interface the app already uses (collection/doc, set/update/delete, onSnapshot).
const KEY = 'nawaqes.data.v1';
const COLLECTIONS = ['items', 'catalog', 'settings'];

function emptyData() {
  const d = {};
  COLLECTIONS.forEach(c => { d[c] = {}; });
  return d;
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && typeof d === 'object') { COLLECTIONS.forEach(c => { if (!d[c] || typeof d[c] !== 'object') d[c] = {}; }); return d; }
  } catch (e) {}
  return emptyData();
}
const clone = v => JSON.parse(JSON.stringify(v));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function openLocalDb() {
  let data = load();
  const listeners = new Set();
  const meta = { fromCache: false, hasPendingWrites: false };
  let pending = false;

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { const err = new Error('storage-full'); err.code = 'resource-exhausted'; throw err; }
  };
  const emit = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; listeners.forEach(f => f()); }, 0);
  };
  // another tab or window of the app changed the data
  window.addEventListener('storage', e => { if (e.key === KEY) { data = load(); emit(); } });

  // ask the browser not to clear the data when the phone is low on space
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  const snapDoc = (col, id) => {
    const d = data[col] && data[col][id];
    return { id, exists: !!d, data: () => (d ? clone(d) : undefined), metadata: meta };
  };
  const watch = fire => { listeners.add(fire); setTimeout(fire, 0); return () => listeners.delete(fire); };
  const docRef = (col, id) => ({
    id,
    set: body => { data[col][id] = clone(body); save(); emit(); return Promise.resolve(); },
    update: body => {
      if (!data[col][id]) { const e = new Error('not-found'); e.code = 'not-found'; return Promise.reject(e); }
      Object.assign(data[col][id], clone(body)); save(); emit(); return Promise.resolve();
    },
    delete: () => { delete data[col][id]; save(); emit(); return Promise.resolve(); },
    onSnapshot: next => watch(() => next(snapDoc(col, id)))
  });

  return {
    doc: path => { const [col, id] = path.split('/'); return docRef(col, id); },
    collection: col => ({
      doc: id => docRef(col, id || newId()),
      onSnapshot: next => watch(() => {
        const docs = Object.keys(data[col] || {}).map(id => snapDoc(col, id));
        next({ docs, size: docs.length, empty: !docs.length, metadata: meta });
      })
    }),
    // ops: [{path: 'items/abc', data: {...}}]
    batchSet: async ops => {
      ops.forEach(o => { const [col, id] = o.path.split('/'); if (data[col]) data[col][id] = clone(o.data); });
      save(); emit();
    }
  };
}
