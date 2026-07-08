import { COMPANIES, BUYER_ADDR } from './data.js';
import { LS, openDb, idbPut, idbAll, idbDel } from './db.js';
import { calc, fmtPL, isoLocal } from './calc.js';
import { buildXml, download, fname } from './xml.js';

// ═══ daty domyślne ══════════════════════════════════════════
const today    = new Date();
const lastPrev = new Date(today.getFullYear(), today.getMonth(), 0); // ostatni dzień poprz. mc
const dueDefault = new Date(lastPrev);
dueDefault.setDate(dueDefault.getDate() + 14);

const elSale  = document.getElementById("g-sale");
const elIssue = document.getElementById("g-issue");
const elDue   = document.getElementById("g-due");
const elRate  = document.getElementById("g-rate");
const elLast  = document.getElementById("g-last");
const elYear  = document.getElementById("g-year");

elSale.value  = isoLocal(lastPrev);
elIssue.value = isoLocal(today);
elDue.value   = isoLocal(dueDefault);
elYear.value  = today.getFullYear();

// data sprzedaży zmieniona ręcznie → termin przelicza się +14
elSale.addEventListener("change", () => {
    if (!elSale.value) return;
    const d = new Date(elSale.value + "T12:00:00");
    d.setDate(d.getDate() + 14);
    elDue.value = isoLocal(d);
});

// ═══ ustawienia z localStorage ══════════════════════════════
const savedRate = LS.get("rate", null);
if (savedRate) elRate.value = savedRate;
elRate.addEventListener("input", () => { if (elRate.value) LS.set("rate", elRate.value); });

const savedYear = LS.get("lastFvYear", null);
const savedN    = LS.get("lastFvN", null);
if (savedYear == String(elYear.value) && savedN !== null) elLast.value = savedN;

elLast.addEventListener("input", () => saveLastFv());
elYear.addEventListener("input", () => {
    const y = String(elYear.value);
    elLast.value = (LS.get("lastFvYear", null) === y) ? LS.get("lastFvN", "0") : "0";
});

function saveLastFv() {
    LS.set("lastFvYear", String(elYear.value));
    LS.set("lastFvN", String(elLast.value));
}

// ═══ budowa kolumn ══════════════════════════════════════════
const colsEl = document.getElementById("view-issue");

COMPANIES.forEach(c => {
    const el = document.createElement("section");
    el.className = "col";
    el.innerHTML = `
        <span class="tag">${c.tag}</span>
        <h2>Nationale-Nederlanden<br>${c.short}</h2>
        <div class="entity">NIP ${c.nip}<br>${BUYER_ADDR}</div>
        <div class="fv-nr" id="nr-${c.key}">FV —</div>
        <div class="field">
            <label for="h-${c.key}">Godziny</label>
            <input id="h-${c.key}" type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal">
        </div>
        <div class="field">
            <label for="z-${c.key}">Nr zamówienia</label>
            <input id="z-${c.key}" class="small" type="text" value="${LS.get("zam." + c.key, c.zam)}" pattern="\\d{8}" maxlength="8">
        </div>
        <dl class="calc">
            <dt>netto</dt><dd id="n-${c.key}" class="zero">0,00</dd>
            <dt>VAT 23%</dt><dd id="v-${c.key}" class="zero">0,00</dd>
            <dt>brutto</dt><dd id="b-${c.key}" class="brutto zero">0,00</dd>
        </dl>
        <div class="btn-row">
            <button class="b-approve" id="ap-${c.key}" disabled>Zatwierdź</button>
            <button class="b-dl" id="dl-${c.key}" disabled>Pobierz XML</button>
        </div>`;
    colsEl.appendChild(el);

    // draft godzin przeżywa odświeżenie strony
    const h = document.getElementById("h-" + c.key);
    const draft = LS.get("draft." + c.key, "");
    if (draft) h.value = draft;
    h.addEventListener("input", () => LS.set("draft." + c.key, h.value));
    document.getElementById("z-" + c.key).addEventListener("input", e => LS.set("zam." + c.key, e.target.value));
});

// stan zatwierdzenia w tej sesji: key -> rekord faktury
const approved = {};

function colState(c) {
    const raw    = document.getElementById("h-" + c.key).value;
    const h      = parseFloat(raw);
    const rateGr = Math.round(parseFloat(elRate.value || "0") * 100);
    if (!raw || isNaN(h) || h <= 0 || !rateGr) return null;
    const hoursCent = Math.round(h * 100);
    return { hoursCent, rateGr, ...calc(hoursCent, rateGr) };
}

function refresh() {
    let th = 0, tn = 0, tv = 0, tb = 0, anyApproved = false;

    COMPANIES.forEach(c => {
        const rec  = approved[c.key];
        const s    = rec
            ? { hoursCent: rec.hoursCent, netto: rec.netto, vat: rec.vat, brutto: rec.brutto }
            : colState(c);
        const nrEl = document.getElementById("nr-" + c.key);
        const ap   = document.getElementById("ap-" + c.key);
        const dl   = document.getElementById("dl-" + c.key);

        ["n", "v", "b"].forEach(p => document.getElementById(p + "-" + c.key).classList.toggle("zero", !s));

        if (s) {
            document.getElementById("n-" + c.key).textContent = fmtPL(s.netto);
            document.getElementById("v-" + c.key).textContent = fmtPL(s.vat);
            document.getElementById("b-" + c.key).textContent = fmtPL(s.brutto);
            th += s.hoursCent; tn += s.netto; tv += s.vat; tb += s.brutto;
        } else {
            ["n", "v", "b"].forEach(p => document.getElementById(p + "-" + c.key).textContent = "0,00");
        }

        if (rec) {
            nrEl.textContent = "FV " + rec.nr;
            ap.disabled = true; ap.classList.add("done"); ap.textContent = "Zatwierdzona ✓";
            dl.disabled = false;
            anyApproved = true;
        } else {
            nrEl.textContent = "FV — (nada się przy zatwierdzeniu)";
            ap.disabled = !s; ap.classList.remove("done"); ap.textContent = "Zatwierdź";
            dl.disabled = true; dl.textContent = "Pobierz XML";
        }
    });

    document.getElementById("t-h").textContent = fmtPL(th);
    document.getElementById("t-n").textContent = fmtPL(tn) + " zł";
    document.getElementById("t-v").textContent = fmtPL(tv) + " zł";
    document.getElementById("t-b").textContent = fmtPL(tb) + " zł";
    document.getElementById("dl-all").disabled = !anyApproved;
}

document.addEventListener("input", refresh);

// ═══ zatwierdzanie ══════════════════════════════════════════
async function approve(c) {
    const s = colState(c);
    if (!s) return;
    const zam = document.getElementById("z-" + c.key).value.trim();
    if (!/^\d{8}$/.test(zam)) { alert("Nr zamówienia musi mieć 8 cyfr."); return; }
    if (!elSale.value || !elIssue.value || !elDue.value) { alert("Uzupełnij daty."); return; }

    const next = parseInt(elLast.value || "0", 10) + 1;
    const nr   = `${elYear.value}/${next}`;
    const rec  = {
        nr, key: c.key, tag: c.tag, company: c.name, nip: c.nip, zam,
        hoursCent: s.hoursCent, rateGr: s.rateGr,
        netto: s.netto, vat: s.vat, brutto: s.brutto,
        saleDate: elSale.value, issueDate: elIssue.value, dueDate: elDue.value,
        createdAt: Date.now()
    };
    rec.xml = buildXml(rec);

    try {
        await idbPut(rec);
    } catch (e) {
        alert("Nie udało się zapisać do IndexedDB: " + e);
        return;
    }

    approved[c.key] = rec;
    elLast.value = next;
    saveLastFv();
    LS.del("draft." + c.key);
    document.getElementById("h-" + c.key).disabled = true;
    document.getElementById("z-" + c.key).disabled = true;
    refresh();
}

COMPANIES.forEach(c => {
    document.getElementById("ap-" + c.key).addEventListener("click", () => approve(c));
    document.getElementById("dl-" + c.key).addEventListener("click", e => {
        const rec = approved[c.key];
        if (!rec) return;
        download(fname(rec), rec.xml);
        e.target.textContent = "Pobrano ✓";
    });
});

document.getElementById("dl-all").addEventListener("click", () => {
    Object.values(approved).forEach((rec, i) => {
        setTimeout(() => {
            download(fname(rec), rec.xml);
            document.getElementById("dl-" + rec.key).textContent = "Pobrano ✓";
        }, i * 350);
    });
});

// ═══ rejestr (podstrona) ════════════════════════════════════
const tabIssue  = document.getElementById("tab-issue");
const tabReg    = document.getElementById("tab-register");
const viewIssue = document.getElementById("view-issue");
const viewReg   = document.getElementById("view-register");

tabIssue.addEventListener("click", () => {
    tabIssue.classList.add("active"); tabReg.classList.remove("active");
    viewReg.classList.remove("show"); viewIssue.classList.remove("hide");
});

tabReg.addEventListener("click", async () => {
    tabReg.classList.add("active"); tabIssue.classList.remove("active");
    viewIssue.classList.add("hide"); viewReg.classList.add("show");
    renderRegister();
});

async function renderRegister() {
    const body = document.getElementById("reg-body");
    let list = [];
    try {
        list = await idbAll();
    } catch (e) {
        body.innerHTML = `<p class="empty">Błąd odczytu IndexedDB: ${e}</p>`;
        return;
    }
    if (!list.length) {
        body.innerHTML = `<p class="empty">Brak zatwierdzonych faktur. Wystaw pierwszą w zakładce Wystawianie.</p>`;
        return;
    }

    // sortowanie: rok malejąco, numer malejąco
    list.sort((a, b) => {
        const [ya, na] = a.nr.split("/").map(Number);
        const [yb, nb] = b.nr.split("/").map(Number);
        return yb - ya || nb - na;
    });

    let th = 0, tn = 0, tb = 0;
    const rows = list.map(r => {
        th += r.hoursCent; tn += r.netto; tb += r.brutto;
        return `<tr>
            <td><b>${r.nr}</b></td>
            <td>${r.tag}</td>
            <td>${r.issueDate}</td>
            <td>${r.saleDate}</td>
            <td>${r.zam}</td>
            <td class="r">${fmtPL(r.hoursCent)}</td>
            <td class="r">${fmtPL(r.netto)}</td>
            <td class="r">${fmtPL(r.brutto)}</td>
            <td class="r">
                <button class="mini" data-act="xml" data-nr="${r.nr}">XML</button>
                <button class="mini" data-act="del" data-nr="${r.nr}">Usuń</button>
            </td>
        </tr>`;
    }).join("");

    body.innerHTML = `<table>
        <thead><tr>
            <th>FV</th><th>Spółka</th><th>Wystawiono</th><th>Sprzedaż</th>
            <th>Zamówienie</th><th class="r">Godz.</th><th class="r">Netto</th>
            <th class="r">Brutto</th><th class="r"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
            <td colspan="5">RAZEM (${list.length} FV)</td>
            <td class="r">${fmtPL(th)}</td>
            <td class="r">${fmtPL(tn)}</td>
            <td class="r">${fmtPL(tb)}</td>
            <td></td>
        </tr></tfoot>
    </table>`;

    body.querySelectorAll(".mini").forEach(b => b.addEventListener("click", async e => {
        const nr  = e.target.dataset.nr;
        const rec = list.find(r => r.nr === nr);
        if (!rec) return;
        if (e.target.dataset.act === "xml") {
            download(fname(rec), rec.xml);
        } else {
            if (!confirm(`Usunąć FV ${nr} z rejestru? Numeracja nie zostanie cofnięta.`)) return;
            await idbDel(nr);
            if (approved[rec.key] && approved[rec.key].nr === nr) delete approved[rec.key];
            renderRegister();
            refresh();
        }
    }));
}

// ═══ start ══════════════════════════════════════════════════
openDb()
    .then(refresh)
    .catch(e => {
        alert("IndexedDB niedostępne w tej przeglądarce/trybie: " + e + "\nZatwierdzanie nie będzie działać.");
        refresh();
    });
