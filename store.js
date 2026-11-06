// Firebase connection: Google sign-in + Firestore with offline cache.
// The rest of the app talks to the small `db` object returned by `store.db(uid)`.
import { firebaseConfig as fileConfig } from './firebase-config.js';

const V = '10.12.2';
const LOCAL_KEY = 'nawaqes.firebaseConfig';

export function readLocalConfig() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (e) { return null; }
}
export function saveLocalConfig(cfg) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(cfg)); return true; } catch (e) { return false; }
}
export function clearLocalConfig() {
  try { localStorage.removeItem(LOCAL_KEY); } catch (e) {}
}

// Accepts the snippet Firebase shows ("const firebaseConfig = { apiKey: "...", ... }") or plain JSON.
export function parseConfig(text) {
  const out = {};
  const re = /["']?(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId|measurementId)["']?\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(String(text || '')))) out[m[1]] = m[2];
  return out.apiKey && out.projectId && out.appId ? out : null;
}

export async function initStore() {
  const config = (fileConfig && fileConfig.apiKey) ? fileConfig : readLocalConfig();
  if (!config || !config.apiKey) return { configured: false };

  const [appMod, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
  ]);
  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  auth.languageCode = 'ar';
  let fs;
  try {
    fs = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
    });
  } catch (e) {
    fs = fsMod.getFirestore(app);
  }

  const wrapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: s.metadata });

  function makeDb(uid) {
    const root = ['shops', uid];
    const docRef = (...segs) => {
      const ref = fsMod.doc(fs, ...root, ...segs);
      return {
        id: ref.id,
        set: body => fsMod.setDoc(ref, body),
        update: body => fsMod.updateDoc(ref, body),
        delete: () => fsMod.deleteDoc(ref),
        onSnapshot: (next, err) => fsMod.onSnapshot(ref, { includeMetadataChanges: true }, s => next(wrapDoc(s)), err)
      };
    };
    return {
      doc: path => docRef(...path.split('/')),
      collection: name => ({
        doc: id => docRef(name, id || fsMod.doc(fsMod.collection(fs, ...root, name)).id),
        onSnapshot: (next, err) => fsMod.onSnapshot(
          fsMod.collection(fs, ...root, name), { includeMetadataChanges: true },
          s => next({ docs: s.docs.map(wrapDoc), size: s.size, empty: s.empty, metadata: s.metadata }), err)
      }),
      // ops: [{path: 'items/abc', data: {...}}] written with set(), 400 per batch
      batchSet: async ops => {
        for (let i = 0; i < ops.length; i += 400) {
          const b = fsMod.writeBatch(fs);
          ops.slice(i, i + 400).forEach(o => b.set(fsMod.doc(fs, ...root, ...o.path.split('/')), o.data));
          await b.commit();
        }
      }
    };
  }

  return {
    configured: true,
    projectId: config.projectId,
    onAuth: cb => authMod.onAuthStateChanged(auth, cb),
    signIn: async () => {
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        const code = e && e.code;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') {
          await authMod.signInWithRedirect(auth, provider);
        } else {
          throw e;
        }
      }
    },
    signOut: () => authMod.signOut(auth),
    db: makeDb
  };
}
