import { COMPANIES, BUYER_ADDR } from "./data.js";
import { LS, openDb, idbPut, idbPutImport, idbAll, idbDel } from "./db.js?v=20260708a";
import { calc, fmtPL } from "./calc.js";
import { buildXml, download, fname } from "./xml.js";
import { addDays, dayjs, formatPeriodLabel, lastDayPrevMonth, toIsoDate, today } from "./dayjs.js";
import { importIssuedInvoices, fetchInvoiceRecord } from "./ksef.js?v=20260709a";
import { importInvoicesFromFiles } from "./file-import.js?v=20260709a";

const currentDate = today();
const lastPrev = lastDayPrevMonth(currentDate);
const dueDefault = addDays(lastPrev, 14);

const elSale = document.getElementById("g-sale");
const elIssue = document.getElementById("g-issue");
const elDue = document.getElementById("g-due");
const elRate = document.getElementById("g-rate");
const elPrefix = document.getElementById("g-prefix");

const tabIssue = document.getElementById("tab-issue");
const tabReg = document.getElementById("tab-register");
const tabImport = document.getElementById("tab-import");
const tabSettings = document.getElementById("tab-settings");
const viewIssue = document.getElementById("view-issue");
const viewReg = document.getElementById("view-register");
const viewImport = document.getElementById("view-import");
const viewSettings = document.getElementById("view-settings");

const elSellerName = document.getElementById("s-seller-name");
const elSellerNip = document.getElementById("s-seller-nip");
const elSellerAddr = document.getElementById("s-seller-addr");
const elSellerNrb = document.getElementById("s-seller-nrb");
const elSellerCity = document.getElementById("s-seller-city");
const elImportToken = document.getElementById("ksef-token");
const elImportFrom = document.getElementById("ksef-from");
const elImportTo = document.getElementById("ksef-to");
const elImportFiles = document.getElementById("ksef-files");
const elImportRun = document.getElementById("ksef-import-run");
const elImportFilesRun = document.getElementById("ksef-files-run");
const elImportStatus = document.getElementById("ksef-import-status");
const elImportResults = document.getElementById("ksef-import-results");

const approved = {};
const colsEl = document.getElementById("view-issue");

let ksefAccessToken = null;
const retryMetadataById = new Map();
let numberingState = {
    prefix: "",
    existingNumbers: new Set(),
    nextNumber: 1
};

function normalizeRecord(record) {
    return {
        ...record,
        source: record.source || "local",
        id: record.id || record.nr
    };
}

function defaultPrefixFor(dateValue) {
    return `FV/${dayjs(dateValue).year()}/`;
}

function parseNumberSuffix(nr, prefix) {
    if (!nr || !prefix || !nr.startsWith(prefix)) {
        return null;
    }
    const value = Number.parseInt(nr.slice(prefix.length), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
}

async function loadNumberingState(prefix) {
    if (!prefix) {
        return {
            prefix: "",
            existingNumbers: new Set(),
            nextNumber: 1
        };
    }

    const all = await idbAll();
    const numbers = all
        .map(record => parseNumberSuffix(normalizeRecord(record).nr, prefix))
        .filter(number => Number.isInteger(number));

    return {
        prefix,
        existingNumbers: new Set(numbers),
        nextNumber: numbers.length ? Math.max(...numbers) + 1 : 1
    };
}

function validateNextNrInput() {
    return true;
}

function getInvoiceNumberInput(companyKey) {
    return document.getElementById("fvn-" + companyKey);
}

function validateCompanyInvoiceNumber(company, options = {}) {
    const input = getInvoiceNumberInput(company.key);
    if (!input || input.disabled) {
        return true;
    }

    const prefix = elPrefix.value.trim();
    const rawValue = input.value.trim();
    const number = Number.parseInt(rawValue, 10);
    const expected = Number.parseInt(input.dataset.expectedNumber || "", 10);
    let message = "";

    if (!prefix) {
        message = "Podaj prefiks numeru FV w nagłówku.";
    } else if (!rawValue) {
        message = "Wpisz numer FV.";
    } else if (!Number.isInteger(number) || number < 1) {
        message = "Numer FV musi być dodatnią liczbą całkowitą.";
    } else if (numberingState.prefix === prefix && numberingState.existingNumbers.has(number)) {
        message = `Numer ${prefix}${number} już jest w bazie.`;
    } else if (Number.isInteger(expected) && number !== expected) {
        message = `Dla tej kolumny oczekiwany jest numer ${prefix}${expected}.`;
    }

    input.setCustomValidity(message);
    input.title = message;
    if (message && options.report) {
        input.reportValidity();
    }
    return !message;
}

async function initializeIssuePeriod() {
    const defaultSaleDate = toIsoDate(lastPrev);
    const preferredPeriod = defaultSaleDate.slice(0, 7);
    let list = [];

    try {
        list = await idbAll();
    } catch {
        return;
    }

    const records = list
        .map(normalizeRecord)
        .filter(record => record.saleDate);

    if (!records.length) {
        return;
    }

    const periodMatches = records.filter(record => record.saleDate.slice(0, 7) === preferredPeriod);
    const scoped = periodMatches.length ? periodMatches : records;
    const latestRecord = scoped.reduce((latest, record) => {
        if (!latest) {
            return record;
        }
        return record.saleDate > latest.saleDate ? record : latest;
    }, null);

    if (!latestRecord) {
        return;
    }

    elSale.value = latestRecord.saleDate;
    if (!LS.get("prefix", "")) {
        elPrefix.value = defaultPrefixFor(latestRecord.saleDate);
    }
    elDue.value = toIsoDate(addDays(elSale.value, 14));
}

elSale.value = toIsoDate(lastPrev);
elIssue.value = toIsoDate(currentDate);
elDue.value = toIsoDate(dueDefault);
elImportFrom.value = LS.get("ksefImportFrom", toIsoDate(lastPrev));
elImportTo.value = LS.get("ksefImportTo", toIsoDate(currentDate));

elImportFrom.addEventListener("change", () => LS.set("ksefImportFrom", elImportFrom.value));
elImportTo.addEventListener("change", () => LS.set("ksefImportTo", elImportTo.value));

elSale.addEventListener("change", () => {
    if (!elSale.value) return;
    elDue.value = toIsoDate(addDays(elSale.value, 14));
    checkPeriodStatus();
});

const savedRate = LS.get("rate", null);
if (savedRate) {
    elRate.value = savedRate;
}

elRate.addEventListener("input", () => {
    if (elRate.value) {
        LS.set("rate", elRate.value);
    }
});

elPrefix.value = LS.get("prefix", defaultPrefixFor(lastPrev));
elPrefix.addEventListener("input", () => {
    LS.set("prefix", elPrefix.value);
    updateNextNr();
});

function getSeller() {
    return {
        name: LS.get("sellerName", "").trim(),
        nip: LS.get("sellerNip", "").trim(),
        addr: LS.get("sellerAddr", "").trim(),
        nrb: LS.get("sellerNrb", "").trim(),
        city: LS.get("sellerCity", "").trim()
    };
}

function checkSellerComplete() {
    const seller = getSeller();
    const ok = seller.name && seller.nip && seller.addr && seller.nrb && seller.city;
    document.getElementById("s-warn").hidden = !!ok;
    const badge = document.querySelector("#tab-settings .badge");
    if (!ok && !badge) {
        const nextBadge = document.createElement("span");
        nextBadge.className = "badge";
        nextBadge.textContent = "!";
        tabSettings.appendChild(nextBadge);
    } else if (ok && badge) {
        badge.remove();
    }
}

function showTab(active) {
    [tabIssue, tabReg, tabImport, tabSettings].forEach(tab => tab.classList.toggle("active", tab === active));
    viewIssue.classList.toggle("hide", active !== tabIssue);
    viewReg.classList.toggle("show", active === tabReg);
    viewImport.classList.toggle("show", active === tabImport);
    viewSettings.classList.toggle("show", active === tabSettings);
}

async function updateNextNr() {
    const prefix = elPrefix.value.trim();
    if (!prefix) {
        numberingState = {
            prefix: "",
            existingNumbers: new Set(),
            nextNumber: 1
        };
        refresh();
        return;
    }

    try {
        numberingState = await loadNumberingState(prefix);
    } catch {
        numberingState = {
            prefix,
            existingNumbers: new Set(),
            nextNumber: 1
        };
    }

    refresh();
}

COMPANIES.forEach(company => {
    const el = document.createElement("section");
    el.className = "col";
    el.innerHTML = `
        <span class="tag">${company.tag}</span>
        <h2>Nationale-Nederlanden<br>${company.short}</h2>
        <div class="entity">NIP ${company.nip}<br>${BUYER_ADDR}</div>
        <div class="fv-nr" id="nr-${company.key}">FV —</div>
        <div class="field fv-number-field">
            <label for="fvn-${company.key}">Numer FV</label>
            <input id="fvn-${company.key}" type="number" min="1" required inputmode="numeric">
        </div>
        <div class="period-status" id="ps-${company.key}"></div>
        <div class="field">
            <label for="h-${company.key}">Godziny</label>
            <input id="h-${company.key}" type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal">
        </div>
        <div class="field">
            <label for="z-${company.key}">Nr zamówienia</label>
            <input id="z-${company.key}" class="small" type="text" value="${LS.get("zam." + company.key, company.zam)}" pattern="\\d{8}" maxlength="8">
        </div>
        <dl class="calc">
            <dt>netto</dt><dd id="n-${company.key}" class="zero">0,00</dd>
            <dt>VAT 23%</dt><dd id="v-${company.key}" class="zero">0,00</dd>
            <dt>brutto</dt><dd id="b-${company.key}" class="brutto zero">0,00</dd>
        </dl>
        <div class="btn-row">
            <button class="b-approve" id="ap-${company.key}" disabled>Zatwierdź</button>
            <button class="b-dl" id="dl-${company.key}" disabled>Pobierz XML</button>
        </div>`;
    colsEl.appendChild(el);

    const hoursInput = document.getElementById("h-" + company.key);
    const draft = LS.get("draft." + company.key, "");
    if (draft) {
        hoursInput.value = draft;
    }
    hoursInput.addEventListener("input", () => LS.set("draft." + company.key, hoursInput.value));
    document.getElementById("z-" + company.key).addEventListener("input", event => LS.set("zam." + company.key, event.target.value));
    const invoiceInput = getInvoiceNumberInput(company.key);
    invoiceInput.addEventListener("input", () => {
        const expected = invoiceInput.dataset.expectedNumber || "";
        invoiceInput.dataset.manual = invoiceInput.value.trim() && invoiceInput.value.trim() !== expected ? "1" : "0";
        validateCompanyInvoiceNumber(company);
    });
    invoiceInput.addEventListener("change", () => validateCompanyInvoiceNumber(company));
});

function colState(company) {
    const rawHours = document.getElementById("h-" + company.key).value;
    const hours = parseFloat(rawHours);
    const rateGr = Math.round(parseFloat(elRate.value || "0") * 100);
    if (!rawHours || Number.isNaN(hours) || hours <= 0 || !rateGr) {
        return null;
    }
    const hoursCent = Math.round(hours * 100);
    return { hoursCent, rateGr, ...calc(hoursCent, rateGr) };
}

function refresh() {
    let th = 0;
    let tn = 0;
    let tv = 0;
    let tb = 0;
    let anyApproved = false;
    const prefix = elPrefix.value.trim();
    const periodKey = `${prefix}|${elSale.value.slice(0, 7)}`;
    let rollingNumber = numberingState.prefix === prefix ? numberingState.nextNumber : null;

    COMPANIES.forEach(company => {
        const record = approved[company.key];
        const state = record
            ? { hoursCent: record.hoursCent, netto: record.netto, vat: record.vat, brutto: record.brutto }
            : colState(company);
        const nrEl = document.getElementById("nr-" + company.key);
        const invoiceInput = getInvoiceNumberInput(company.key);
        const approveButton = document.getElementById("ap-" + company.key);
        const downloadButton = document.getElementById("dl-" + company.key);

        ["n", "v", "b"].forEach(prefix => {
            document.getElementById(prefix + "-" + company.key).classList.toggle("zero", !state);
        });

        if (state) {
            document.getElementById("n-" + company.key).textContent = fmtPL(state.netto);
            document.getElementById("v-" + company.key).textContent = fmtPL(state.vat);
            document.getElementById("b-" + company.key).textContent = fmtPL(state.brutto);
            th += state.hoursCent;
            tn += state.netto;
            tv += state.vat;
            tb += state.brutto;
        } else {
            ["n", "v", "b"].forEach(prefix => {
                document.getElementById(prefix + "-" + company.key).textContent = "0,00";
            });
        }

        if (record) {
            nrEl.textContent = "FV " + record.nr;
            const assignedNumber = parseNumberSuffix(record.nr, prefix);
            if (assignedNumber) {
                rollingNumber = assignedNumber + 1;
            }
            invoiceInput.value = assignedNumber || "";
            invoiceInput.dataset.expectedNumber = assignedNumber || "";
            invoiceInput.dataset.manual = "0";
            invoiceInput.dataset.periodKey = periodKey;
            invoiceInput.disabled = true;
            invoiceInput.setCustomValidity("");
            invoiceInput.title = "";
            approveButton.disabled = true;
            approveButton.classList.add("done");
            approveButton.textContent = record.source === "ksef" ? "Jest w KSeF ✓" : "Zatwierdzona ✓";
            downloadButton.disabled = false;
            anyApproved = true;
        } else {
            if (invoiceInput.dataset.periodKey !== periodKey) {
                invoiceInput.value = "";
                invoiceInput.dataset.manual = "0";
                invoiceInput.dataset.periodKey = periodKey;
            }
            invoiceInput.disabled = false;
            invoiceInput.dataset.expectedNumber = Number.isInteger(rollingNumber) && rollingNumber > 0 ? String(rollingNumber) : "";
            if (invoiceInput.dataset.manual !== "1") {
                invoiceInput.value = invoiceInput.dataset.expectedNumber;
            }
            const displayNumber = Number.parseInt(invoiceInput.value, 10);
            nrEl.textContent = prefix && Number.isInteger(displayNumber) && displayNumber > 0
                ? "FV " + prefix + displayNumber
                : "FV — (ustaw prefiks i numer)";
            if (Number.isInteger(rollingNumber) && rollingNumber > 0) {
                rollingNumber += 1;
            }
            validateCompanyInvoiceNumber(company);
            approveButton.disabled = !state;
            approveButton.classList.remove("done");
            approveButton.textContent = "Zatwierdź";
            downloadButton.disabled = true;
            downloadButton.textContent = "Pobierz XML";
        }
    });

    document.getElementById("t-h").textContent = fmtPL(th);
    document.getElementById("t-n").textContent = fmtPL(tn) + " zł";
    document.getElementById("t-v").textContent = fmtPL(tv) + " zł";
    document.getElementById("t-b").textContent = fmtPL(tb) + " zł";
    document.getElementById("dl-all").disabled = !anyApproved;
}

async function approve(company) {
    const state = colState(company);
    if (!state) {
        return;
    }

    const zam = document.getElementById("z-" + company.key).value.trim();
    if (!/^\d{8}$/.test(zam)) {
        alert("Nr zamówienia musi mieć 8 cyfr.");
        return;
    }
    if (!elSale.value || !elIssue.value || !elDue.value) {
        alert("Uzupełnij daty.");
        return;
    }

    const seller = getSeller();
    if (!seller.name || !seller.nip || !seller.addr || !seller.nrb || !seller.city) {
        alert("Uzupełnij dane sprzedawcy (Nazwa, NIP, Adres, NRB, Miasto) w zakładce Ustawienia.");
        showTab(tabSettings);
        return;
    }

    const prefix = elPrefix.value.trim();
    if (!prefix) {
        alert("Podaj prefiks numeru FV w nagłówku (np. FV/2026/).");
        return;
    }

    if (!validateCompanyInvoiceNumber(company, { report: true })) {
        return;
    }

    const nextNumber = parseInt(getInvoiceNumberInput(company.key).value, 10);

    const nr = prefix + nextNumber;
    const record = {
        id: nr,
        nr,
        source: "local",
        key: company.key,
        tag: company.tag,
        company: company.name,
        nip: company.nip,
        zam,
        hoursCent: state.hoursCent,
        rateGr: state.rateGr,
        netto: state.netto,
        vat: state.vat,
        brutto: state.brutto,
        saleDate: elSale.value,
        issueDate: elIssue.value,
        dueDate: elDue.value,
        createdAt: Date.now()
    };
    record.xml = buildXml(record, seller);

    try {
        await idbPut(record);
    } catch (error) {
        alert("Nie udało się zapisać do IndexedDB: " + error);
        return;
    }

    approved[company.key] = record;
    LS.del("draft." + company.key);
    document.getElementById("h-" + company.key).disabled = true;
    getInvoiceNumberInput(company.key).dataset.manual = "0";
    await updateNextNr();
    await checkPeriodStatus();
    refresh();
}

async function checkPeriodStatus() {
    if (!elSale.value) {
        return;
    }

    const periodYM = elSale.value.slice(0, 7);
    const label = formatPeriodLabel(elSale.value);
    let list = [];

    try {
        list = await idbAll();
    } catch {
        return;
    }

    let needRefresh = false;
    COMPANIES.forEach(company => {
        const statusEl = document.getElementById("ps-" + company.key);
        if (!statusEl) {
            return;
        }
        const found = list.find(record => record.key === company.key && record.saleDate && record.saleDate.slice(0, 7) === periodYM);
        if (found) {
            statusEl.className = "period-status issued";
            statusEl.textContent = `✓ ${found.nr} (${label})`;
            if (!approved[company.key] || approved[company.key].nr !== found.nr) {
                approved[company.key] = found;
                const hoursEl = document.getElementById("h-" + company.key);
                const zamEl = document.getElementById("z-" + company.key);
                if (hoursEl) {
                    hoursEl.value = (found.hoursCent / 100).toFixed(2);
                    hoursEl.disabled = true;
                }
                if (zamEl) {
                    zamEl.value = found.zam;
                    zamEl.disabled = true;
                }
                needRefresh = true;
            }
        } else {
            statusEl.className = "period-status missing";
            statusEl.textContent = "✗ brak FV " + label;
            if (approved[company.key]) {
                delete approved[company.key];
                const hoursEl = document.getElementById("h-" + company.key);
                const zamEl = document.getElementById("z-" + company.key);
                if (hoursEl) {
                    hoursEl.value = LS.get("draft." + company.key, "");
                    hoursEl.disabled = false;
                }
                if (zamEl) {
                    zamEl.disabled = false;
                }
                needRefresh = true;
            }
        }
    });

    if (needRefresh) {
        refresh();
    }
}

async function renderRegister() {
    const body = document.getElementById("reg-body");
    let list = [];
    try {
        list = await idbAll();
    } catch (error) {
        body.innerHTML = `<p class="empty">Błąd odczytu IndexedDB: ${error}</p>`;
        return;
    }

    list = list.map(normalizeRecord);

    if (!list.length) {
        body.innerHTML = '<p class="empty">Brak zatwierdzonych faktur. Wystaw pierwszą w zakładce Wystawianie.</p>';
        return;
    }

    list.sort((a, b) => (b.importedAt || b.createdAt || 0) - (a.importedAt || a.createdAt || 0));

    let th = 0;
    let tn = 0;
    let tb = 0;
    const rows = list.map(record => {
        th += record.hoursCent;
        tn += record.netto;
        tb += record.brutto;
        const sourceBadge = record.source === "ksef" ? '<span class="src-badge ksef">KSeF</span>' : "";
        const meta = record.ksefNumber ? `<span class="ksef-meta">KSeF: ${record.ksefNumber}</span>` : "";
        return `<tr>
            <td><b>${record.nr}</b>${sourceBadge}${meta}</td>
            <td>${record.tag}</td>
            <td>${record.issueDate}</td>
            <td>${record.saleDate}</td>
            <td>${record.zam}</td>
            <td class="r">${fmtPL(record.hoursCent)}</td>
            <td class="r">${fmtPL(record.netto)}</td>
            <td class="r">${fmtPL(record.brutto)}</td>
            <td class="r">
                <button class="mini" data-act="xml" data-id="${record.id}">XML</button>
                <button class="mini" data-act="del" data-id="${record.id}">Usuń</button>
            </td>
        </tr>`;
    }).join("");

    body.innerHTML = `<table>
        <thead><tr><th>FV</th><th>Spółka</th><th>Wystawiono</th><th>Sprzedaż</th><th>Zamówienie</th><th class="r">Godz.</th><th class="r">Netto</th><th class="r">Brutto</th><th class="r"></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5">RAZEM (${list.length} FV)</td><td class="r">${fmtPL(th)}</td><td class="r">${fmtPL(tn)}</td><td class="r">${fmtPL(tb)}</td><td></td></tr></tfoot>
    </table>`;

    body.querySelectorAll(".mini").forEach(button => button.addEventListener("click", async event => {
        const id = event.target.dataset.id;
        const record = list.find(item => item.id === id);
        if (!record) {
            return;
        }

        if (event.target.dataset.act === "xml") {
            download(fname(record), record.xml);
            return;
        }

        if (!confirm(`Usunąć FV ${record.nr} z rejestru?`)) {
            return;
        }

        await idbDel(record.id, record.source === "ksef" ? "imports" : "invoices");
        if (approved[record.key] && approved[record.key].id === record.id) {
            delete approved[record.key];
        }
        await updateNextNr();
        renderRegister();
        refresh();
        checkPeriodStatus();
    }));
}

function setImportStatus(text, kind = "") {
    elImportStatus.textContent = text;
    elImportStatus.className = `import-status${kind ? ` ${kind}` : ""}`;
}

function setImportBusy(isBusy) {
    elImportRun.disabled = isBusy;
    elImportFilesRun.disabled = isBusy;
    elImportFiles.disabled = isBusy;
}

function renderImportResults(items, emptyMessage = "Brak faktur dla wybranego zakresu.") {
    if (!items.length) {
        elImportResults.className = "import-results empty";
        elImportResults.textContent = emptyMessage;
        return;
    }
    elImportResults.className = "import-results";
    elImportResults.innerHTML = items.map(item => `
        <div class="import-result ${item.ok ? "ok" : "fail"}">
            <div class="import-result-head">
                <strong>${item.label}</strong>
                <span class="import-result-state">${item.ok ? item.state : "błąd"}</span>
            </div>
            <div class="import-result-meta">${item.meta}</div>
            <div class="import-result-msg">${item.message}</div>
            ${item.canRetry ? `<button type="button" class="import-retry" data-retry-id="${item.id}">Ponów</button>` : ""}
        </div>
    `).join("");
    wireRetryButtons();
}

function startRetryCountdown(button) {
    let remaining = 60;
    if (button._timer) {
        clearInterval(button._timer);
    }
    button.disabled = true;
    button.textContent = `Ponów za ${remaining} s`;
    button._timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(button._timer);
            button._timer = null;
            button.disabled = false;
            button.textContent = "Ponów";
        } else {
            button.textContent = `Ponów za ${remaining} s`;
        }
    }, 1000);
}

async function handleRetryClick(button) {
    const id = button.dataset.retryId;
    const metadata = retryMetadataById.get(id);
    const row = button.closest(".import-result");
    if (!metadata || !ksefAccessToken) {
        if (row) {
            const msgEl = row.querySelector(".import-result-msg");
            if (msgEl) {
                msgEl.textContent = "Sesja KSeF wygasła. Uruchom import ponownie.";
            }
        }
        button.remove();
        return;
    }
    button.disabled = true;
    button.textContent = "Pobieram...";
    try {
        const record = await fetchInvoiceRecord(ksefAccessToken, metadata, COMPANIES);
        await idbPutImport(record);
        retryMetadataById.delete(id);
        if (row) {
            row.classList.remove("fail");
            row.classList.add("ok");
            const stateEl = row.querySelector(".import-result-state");
            const msgEl = row.querySelector(".import-result-msg");
            if (stateEl) {
                stateEl.textContent = "zaimportowano";
            }
            if (msgEl) {
                msgEl.textContent = `${record.company} · ${fmtPL(record.brutto)} zł brutto`;
            }
        }
        button.remove();
        await renderRegister();
        await updateNextNr();
        await checkPeriodStatus();
        refresh();
    } catch (error) {
        const msgEl = row?.querySelector(".import-result-msg");
        if (msgEl) {
            msgEl.textContent = error?.message || String(error);
        }
        if (error?.status === 429) {
            startRetryCountdown(button);
        } else {
            button.disabled = false;
            button.textContent = "Ponów";
        }
    }
}

function wireRetryButtons() {
    elImportResults.querySelectorAll("button.import-retry").forEach(button => {
        if (button.dataset.wired === "1") {
            return;
        }
        button.dataset.wired = "1";
        button.addEventListener("click", () => handleRetryClick(button));
        startRetryCountdown(button);
    });
}

async function runKsefImport() {
    const token = elImportToken.value.trim();
    const seller = getSeller();

    if (!seller.nip || !/^\d{10}$/.test(seller.nip)) {
        alert("Uzupełnij poprawny NIP sprzedawcy w Ustawieniach przed importem z KSeF.");
        showTab(tabSettings);
        return;
    }
    if (!token) {
        alert("Wklej token KSeF do jednorazowej próby importu.");
        return;
    }
    if (!elImportFrom.value || !elImportTo.value) {
        alert("Uzupełnij zakres dat importu.");
        return;
    }
    if (elImportFrom.value > elImportTo.value) {
        alert("Data początkowa importu nie może być późniejsza niż końcowa.");
        return;
    }
    if (dayjs(elImportTo.value).isAfter(dayjs(elImportFrom.value).add(3, "month"))) {
        alert("Zakres importu nie może przekraczać 3 miesięcy (limit KSeF).");
        return;
    }

    setImportBusy(true);
    setImportStatus("Startuję import z KSeF...", "busy");
    renderImportResults([], "Trwa pobieranie statusów importu...");
    ksefAccessToken = null;
    retryMetadataById.clear();

    try {
        const existing = new Set((await idbAll()).map(record => normalizeRecord(record).id));
        const result = await importIssuedInvoices({
            token,
            contextNip: seller.nip,
            from: elImportFrom.value,
            to: elImportTo.value,
            companies: COMPANIES,
            onProgress: text => setImportStatus(text, "busy")
        });
        ksefAccessToken = result.accessToken || null;

        const statuses = [];
        let importedCount = 0;
        let failedCount = 0;

        for (const item of result.items) {
            const invoiceLabel = item.metadata?.invoiceNumber || item.metadata?.ksefNumber || item.record?.nr || "Faktura";
            if (!item.ok) {
                failedCount += 1;
                const canRetry = item.status === 429 && !!item.metadata?.ksefNumber;
                if (canRetry) {
                    retryMetadataById.set(item.metadata.ksefNumber, item.metadata);
                }
                statuses.push({
                    ok: false,
                    id: item.metadata?.ksefNumber || "",
                    label: invoiceLabel,
                    state: "błąd",
                    meta: item.metadata?.ksefNumber || "Brak numeru KSeF",
                    message: item.error,
                    canRetry
                });
                continue;
            }

            try {
                const alreadyExists = existing.has(item.record.id);
                await idbPutImport(item.record);
                importedCount += 1;
                statuses.push({
                    ok: true,
                    label: item.record.nr,
                    state: alreadyExists ? "aktualizacja" : "zaimportowano",
                    meta: item.record.ksefNumber || "Brak numeru KSeF",
                    message: `${item.record.company} · ${fmtPL(item.record.brutto)} zł brutto`
                });
            } catch (error) {
                failedCount += 1;
                statuses.push({
                    ok: false,
                    label: invoiceLabel,
                    state: "błąd",
                    meta: item.metadata?.ksefNumber || "Brak numeru KSeF",
                    message: `Błąd zapisu do IndexedDB: ${error.message || error}`
                });
            }
        }

        renderImportResults(statuses);
        if (failedCount) {
            setImportStatus(`Import zakończony częściowo: ${importedCount} OK, ${failedCount} błędów.`, importedCount ? "ok" : "fail");
        } else if (!result.items.length) {
            setImportStatus("KSeF nie zwrócił żadnej faktury dla wybranego zakresu dat.", "");
            renderImportResults([], "Brak faktur w KSeF dla tego NIP i zakresu dat. Sprawdź zakres oraz czy faktury zostały faktycznie wysłane do KSeF (wersje robocze nie są widoczne).");
        } else {
            setImportStatus(`Import zakończony sukcesem: ${importedCount} faktur.`, "ok");
        }
        elImportToken.value = "";
        await renderRegister();
        await updateNextNr();
        await checkPeriodStatus();
        refresh();
        alert(failedCount ? `Import zakończony częściowo. Sukces: ${importedCount}, błędy: ${failedCount}.` : `Import zakończony sukcesem. Zaimportowano ${importedCount} faktur.`);
    } catch (error) {
        const detail = error?.message || String(error);
        console.error("Import KSeF nie powiódł się:", error);
        setImportStatus(`Import nieudany: ${detail}`, "fail");
        elImportResults.className = "import-results";
        elImportResults.innerHTML = `
            <div class="import-result fail">
                <div class="import-result-head">
                    <strong>Błąd importu z KSeF</strong>
                    <span class="import-result-state">nieudane</span>
                </div>
                <div class="import-result-msg">${detail}</div>
            </div>`;
        alert(`Import z KSeF nie powiódł się: ${detail}`);
    } finally {
        setImportBusy(false);
    }
}

async function runFileImport() {
    const files = Array.from(elImportFiles.files || []);
    if (!files.length) {
        alert("Wybierz co najmniej jeden plik XML albo ZIP.");
        return;
    }

    setImportBusy(true);
    setImportStatus(`Startuję import z plików (${files.length})...`, "busy");
    renderImportResults([], "Trwa odczyt plików...");
    ksefAccessToken = null;
    retryMetadataById.clear();

    try {
        const existing = new Set((await idbAll()).map(record => normalizeRecord(record).id));
        const result = await importInvoicesFromFiles({
            files,
            companies: COMPANIES,
            onProgress: text => setImportStatus(text, "busy")
        });

        const statuses = [];
        let importedCount = 0;
        let failedCount = 0;

        for (const item of result.items) {
            if (!item.ok) {
                failedCount += 1;
                statuses.push({
                    ok: false,
                    label: item.label,
                    state: "błąd",
                    meta: item.meta || "Plik wejściowy",
                    message: item.error
                });
                continue;
            }

            try {
                const alreadyExists = existing.has(item.record.id);
                await idbPutImport(item.record);
                importedCount += 1;
                statuses.push({
                    ok: true,
                    label: item.record.nr,
                    state: alreadyExists ? "aktualizacja" : "zaimportowano",
                    meta: item.record.ksefNumber || item.label,
                    message: `${item.record.company} · ${fmtPL(item.record.brutto)} zł brutto`
                });
            } catch (error) {
                failedCount += 1;
                statuses.push({
                    ok: false,
                    label: item.label,
                    state: "błąd",
                    meta: item.record.ksefNumber || item.record.nr,
                    message: `Błąd zapisu do IndexedDB: ${error.message || error}`
                });
            }
        }

        renderImportResults(statuses, "Nie znaleziono żadnych poprawnych XML-i do importu.");
        if (failedCount) {
            setImportStatus(`Import plików zakończony częściowo: ${importedCount} OK, ${failedCount} błędów.`, importedCount ? "ok" : "fail");
        } else if (!result.items.length) {
            setImportStatus("Nie znaleziono XML-i do importu.", "fail");
        } else {
            setImportStatus(`Import plików zakończony sukcesem: ${importedCount} faktur.`, "ok");
        }
        elImportFiles.value = "";
        await renderRegister();
        await updateNextNr();
        await checkPeriodStatus();
        refresh();
        alert(failedCount ? `Import plików zakończony częściowo. Sukces: ${importedCount}, błędy: ${failedCount}.` : `Import plików zakończony sukcesem. Zaimportowano ${importedCount} faktur.`);
    } catch (error) {
        const detail = error?.message || String(error);
        console.error("Import plików nie powiódł się:", error);
        setImportStatus(`Import plików nieudany: ${detail}`, "fail");
        elImportResults.className = "import-results";
        elImportResults.innerHTML = `
            <div class="import-result fail">
                <div class="import-result-head">
                    <strong>Błąd importu plików</strong>
                    <span class="import-result-state">nieudane</span>
                </div>
                <div class="import-result-msg">${detail}</div>
            </div>`;
        alert(`Import plików nie powiódł się: ${detail}`);
    } finally {
        setImportBusy(false);
    }
}

document.addEventListener("input", refresh);

tabIssue.addEventListener("click", () => showTab(tabIssue));
tabReg.addEventListener("click", async () => {
    showTab(tabReg);
    renderRegister();
});
tabImport.addEventListener("click", () => showTab(tabImport));
tabSettings.addEventListener("click", () => showTab(tabSettings));

elSellerName.value = LS.get("sellerName", "");
elSellerNip.value = LS.get("sellerNip", "");
elSellerAddr.value = LS.get("sellerAddr", "");
elSellerNrb.value = LS.get("sellerNrb", "");
elSellerCity.value = LS.get("sellerCity", "");
document.getElementById("h-seller-name").textContent = getSeller().name || "Twoja Firma";

elSellerName.addEventListener("input", () => {
    const value = elSellerName.value.trim();
    LS.set("sellerName", value);
    document.getElementById("h-seller-name").textContent = value || "Twoja Firma";
    checkSellerComplete();
});
elSellerNip.addEventListener("input", () => {
    LS.set("sellerNip", elSellerNip.value.trim());
    checkSellerComplete();
});
elSellerAddr.addEventListener("input", () => {
    LS.set("sellerAddr", elSellerAddr.value.trim());
    checkSellerComplete();
});
elSellerNrb.addEventListener("input", () => {
    LS.set("sellerNrb", elSellerNrb.value.trim());
    checkSellerComplete();
});
elSellerCity.addEventListener("input", () => {
    LS.set("sellerCity", elSellerCity.value.trim());
    checkSellerComplete();
});

COMPANIES.forEach(company => {
    document.getElementById("ap-" + company.key).addEventListener("click", () => approve(company));
    document.getElementById("dl-" + company.key).addEventListener("click", event => {
        const record = approved[company.key];
        if (!record) {
            return;
        }
        download(fname(record), record.xml);
        event.target.textContent = "Pobrano ✓";
    });
});

elImportRun.addEventListener("click", runKsefImport);
elImportFilesRun.addEventListener("click", runFileImport);

document.getElementById("dl-all").addEventListener("click", () => {
    Object.values(approved).forEach((record, index) => {
        setTimeout(() => {
            download(fname(record), record.xml);
            document.getElementById("dl-" + record.key).textContent = "Pobrano ✓";
        }, index * 350);
    });
});

checkSellerComplete();

openDb().then(() => {
    return initializeIssuePeriod();
}).then(() => {
    return updateNextNr();
}).then(() => {
    return checkPeriodStatus();
}).catch(error => {
    alert("IndexedDB niedostępne w tej przeglądarce/trybie: " + error + "\nZatwierdzanie nie będzie działać.");
    refresh();
});
