// ═══ persystencja: localStorage (ustawienia) ════════════════
export const LS = {
    get(k, def) { try { const v = localStorage.getItem("ksef." + k); return v === null ? def : v } catch (e) { return def } },
    set(k, v)   { try { localStorage.setItem("ksef." + k, v) } catch (e) { } },
    del(k)      { try { localStorage.removeItem("ksef." + k) } catch (e) { } }
};

// ═══ persystencja: IndexedDB (faktury) ══════════════════════
let db = null;

export function openDb() {
    return new Promise((res, rej) => {
        const req = indexedDB.open("ksef", 1);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains("invoices")) {
                const st = d.createObjectStore("invoices", { keyPath: "nr" });
                st.createIndex("byCreated", "createdAt");
            }
        };
        req.onsuccess = e => { db = e.target.result; res(db) };
        req.onerror   = e => rej(e.target.error);
    });
}

export function idbPut(rec) {
    return new Promise((res, rej) => {
        const tx = db.transaction("invoices", "readwrite");
        tx.objectStore("invoices").put(rec);
        tx.oncomplete = res;
        tx.onerror    = e => rej(e.target.error);
    });
}

export function idbAll() {
    return new Promise((res, rej) => {
        const tx  = db.transaction("invoices", "readonly");
        const req = tx.objectStore("invoices").getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror   = e => rej(e.target.error);
    });
}

export function idbDel(nr) {
    return new Promise((res, rej) => {
        const tx = db.transaction("invoices", "readwrite");
        tx.objectStore("invoices").delete(nr);
        tx.oncomplete = res;
        tx.onerror    = e => rej(e.target.error);
    });
}
