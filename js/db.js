// ═══ persystencja: localStorage (ustawienia) ════════════════
export const LS = {
    get(k, def) { try { const v = localStorage.getItem("ksef." + k); return v === null ? def : v } catch (e) { return def } },
    set(k, v)   { try { localStorage.setItem("ksef." + k, v) } catch (e) { } },
    del(k)      { try { localStorage.removeItem("ksef." + k) } catch (e) { } }
};

// ═══ persystencja: IndexedDB (faktury) ══════════════════════
let db = null;
const DB_NAME = "ksef";
const DB_VERSION = 2;
const LOCAL_STORE = "invoices";
const IMPORT_STORE = "imports";

export function openDb() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(LOCAL_STORE)) {
                const st = d.createObjectStore(LOCAL_STORE, { keyPath: "nr" });
                st.createIndex("byCreated", "createdAt");
            }
            if (!d.objectStoreNames.contains(IMPORT_STORE)) {
                const st = d.createObjectStore(IMPORT_STORE, { keyPath: "id" });
                st.createIndex("byCreated", "createdAt");
            }
        };
        req.onsuccess = e => { db = e.target.result; res(db) };
        req.onerror   = e => rej(e.target.error);
    });
}

export function idbPut(rec) {
    return new Promise((res, rej) => {
        const tx = db.transaction(LOCAL_STORE, "readwrite");
        tx.objectStore(LOCAL_STORE).put(rec);
        tx.oncomplete = res;
        tx.onerror    = e => rej(e.target.error);
    });
}

export function idbPutImport(rec) {
    return new Promise((res, rej) => {
        const tx = db.transaction(IMPORT_STORE, "readwrite");
        tx.objectStore(IMPORT_STORE).put(rec);
        tx.oncomplete = res;
        tx.onerror    = e => rej(e.target.error);
    });
}

function idbAllFromStore(storeName) {
    return new Promise((res, rej) => {
        if (!db.objectStoreNames.contains(storeName)) {
            res([]);
            return;
        }
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = e => rej(e.target.error);
    });
}

export function idbAll() {
    return Promise.all([idbAllFromStore(LOCAL_STORE), idbAllFromStore(IMPORT_STORE)]).then(([local, imported]) => local.concat(imported));
}

export function idbAllLocal() {
    return idbAllFromStore(LOCAL_STORE);
}

export function idbDel(id, storeName = LOCAL_STORE) {
    return new Promise((res, rej) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = res;
        tx.onerror    = e => rej(e.target.error);
    });
}
