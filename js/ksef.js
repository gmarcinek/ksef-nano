const API_BASE = "/ksef";

function missingProxyMessage() {
    return "Brak same-origin proxy do KSeF. Netlify obsłuży to przez `_redirects`, ale zwykły lokalny serwer statyczny bez rewritów nie przepuści `POST /ksef/...`.";
}

function isMissingProxyResponse(response, contentType, text) {
    if (!API_BASE.startsWith("/ksef")) {
        return false;
    }
    if (response.status === 404) {
        return true;
    }
    if (response.status === 501 && contentType.includes("text/html") && text.includes("Unsupported method")) {
        return true;
    }
    return false;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function bytesFromBase64(base64) {
    const normalized = String(base64).replace(/\s+/g, "");
    const bin = atob(normalized);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
}

function base64FromBytes(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 1) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

function readAsn1(view, offset) {
    const tag = view.getUint8(offset);
    let length = view.getUint8(offset + 1);
    let headerLength = 2;
    if (length & 0x80) {
        const lengthBytes = length & 0x7f;
        length = 0;
        headerLength += lengthBytes;
        for (let i = 0; i < lengthBytes; i += 1) {
            length = (length << 8) | view.getUint8(offset + 2 + i);
        }
    }
    return {
        tag,
        length,
        headerLength,
        start: offset,
        contentStart: offset + headerLength,
        end: offset + headerLength + length
    };
}

function extractSpkiFromCertificate(certDer) {
    const view = new DataView(certDer.buffer, certDer.byteOffset, certDer.byteLength);
    const certificate = readAsn1(view, 0);
    const tbs = readAsn1(view, certificate.contentStart);
    let offset = tbs.contentStart;
    let part = readAsn1(view, offset);
    if (part.tag === 0xa0) {
        offset = part.end;
    }
    offset = readAsn1(view, offset).end;
    offset = readAsn1(view, offset).end;
    offset = readAsn1(view, offset).end;
    offset = readAsn1(view, offset).end;
    offset = readAsn1(view, offset).end;
    const spki = readAsn1(view, offset);
    return certDer.slice(spki.start, spki.end);
}

async function importKsefEncryptionKey(certificateBase64) {
    const certBytes = bytesFromBase64(certificateBase64);
    const spki = extractSpkiFromCertificate(certBytes);
    return crypto.subtle.importKey(
        "spki",
        spki,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
    );
}

function extractErrorMessage(payload, fallback) {
    if (!payload) {
        return fallback;
    }
    if (payload.detail) {
        return payload.detail;
    }
    if (Array.isArray(payload.errors) && payload.errors.length) {
        return payload.errors.map(item => item.description || item.detail || JSON.stringify(item)).join(" | ");
    }
    if (payload.exception?.exceptionDetailList?.length) {
        return payload.exception.exceptionDetailList
            .map(item => [item.exceptionDescription, ...(item.details || [])].filter(Boolean).join(": "))
            .filter(Boolean)
            .join(" | ");
    }
    if (payload.status?.details?.length) {
        return payload.status.details.join(" | ");
    }
    if (payload.title) {
        return payload.title;
    }
    return fallback;
}

async function ksefFetch(path, options = {}) {
    const { bearer, responseType = "json", ...rest } = options;
    const headers = new Headers(rest.headers || {});
    headers.set("X-Error-Format", "problem-details");
    if (bearer) {
        headers.set("Authorization", `Bearer ${bearer}`);
    }
    if (rest.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, { ...rest, headers });
    } catch (error) {
        throw new Error(missingProxyMessage());
    }
    if (!response.ok) {
        let payload = null;
        let text = "";
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json") || contentType.includes("problem+json")) {
            payload = await response.json().catch(() => null);
        } else {
            text = await response.text().catch(() => "");
        }
        if (isMissingProxyResponse(response, contentType, text)) {
            throw new Error(missingProxyMessage());
        }
        const message = extractErrorMessage(payload, text || `HTTP ${response.status}`);
        throw new Error(`[HTTP ${response.status} ${path}] ${message}`);
    }

    if (responseType === "text") {
        return response.text();
    }
    if (response.status === 204) {
        return null;
    }
    return response.json();
}

async function getTokenEncryptionCertificate() {
    const payload = await ksefFetch("/security/public-key-certificates");
    const certificates = Array.isArray(payload) ? payload : (payload.certificates || []);
    const certificate = certificates.find(item => Array.isArray(item.usage) && item.usage.includes("KsefTokenEncryption"));
    if (!certificate) {
        throw new Error("Brak certyfikatu do szyfrowania tokena KSeF.");
    }
    return certificate;
}

async function authenticateWithToken(token, contextNip, onProgress) {
    onProgress?.("Pobieram challenge uwierzytelnienia...");
    const challenge = await ksefFetch("/auth/challenge", { method: "POST" });
    const certificate = await getTokenEncryptionCertificate();
    onProgress?.("Szyfruję token KSeF kluczem MF...");
    const publicKey = await importKsefEncryptionKey(certificate.certificate);
    const payloadBytes = new TextEncoder().encode(`${token}|${challenge.timestampMs}`);
    const encryptedToken = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, payloadBytes);
    const encryptedTokenBase64 = base64FromBytes(new Uint8Array(encryptedToken));

    onProgress?.("Rozpoczynam uwierzytelnianie tokenem...");
    const init = await ksefFetch("/auth/ksef-token", {
        method: "POST",
        body: JSON.stringify({
            challenge: challenge.challenge,
            contextIdentifier: { type: "Nip", value: contextNip },
            encryptedToken: encryptedTokenBase64,
            publicKeyId: certificate.publicKeyId
        })
    });

    const authToken = init.authenticationToken?.token;
    if (!authToken) {
        throw new Error("KSeF nie zwrócił tokena operacji uwierzytelniania.");
    }

    let authStatus = null;
    const maxAttempts = 15;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        authStatus = await ksefFetch(`/auth/${init.referenceNumber}`, { bearer: authToken });
        const code = authStatus?.status?.code;
        if (code === 200) {
            break;
        }
        if (code !== 100) {
            const detail = extractErrorMessage(authStatus.status, authStatus?.status?.description || "Uwierzytelnianie KSeF zakończyło się błędem.");
            throw new Error(`Uwierzytelnianie KSeF nieudane (kod ${code}): ${detail}`);
        }
        onProgress?.(`KSeF uwierzytelnia token... próba ${attempt + 1}/${maxAttempts}`);
        await wait(800);
    }

    if (authStatus?.status?.code !== 200) {
        throw new Error("KSeF nie zakończył uwierzytelniania w oczekiwanym czasie.");
    }

    onProgress?.("Pobieram access token dla API KSeF...");
    const redeemed = await ksefFetch("/auth/token/redeem", { method: "POST", bearer: authToken });
    if (!redeemed?.accessToken?.token) {
        throw new Error("Nie udało się pobrać access tokena KSeF.");
    }
    return redeemed.accessToken.token;
}

function toKsefDateStart(value) {
    return `${value}T00:00:00`;
}

function toKsefDateEnd(value) {
    return `${value}T23:59:59`;
}

function firstText(node, localName) {
    const items = node.getElementsByTagNameNS("*", localName);
    return items.length ? (items[0].textContent || "").trim() : "";
}

function firstChildElement(node, localName) {
    const items = node.getElementsByTagNameNS("*", localName);
    return items.length ? items[0] : null;
}

function toGrosze(value) {
    const number = Number.parseFloat(String(value || "0").replace(",", "."));
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function parseImportedInvoice(xml, metadata, companies) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
        throw new Error("Nie udało się sparsować XML faktury z KSeF.");
    }

    const sellerNode = firstChildElement(doc, "Podmiot1");
    const buyerNode = firstChildElement(doc, "Podmiot2");
    const issueDate = firstText(doc, "P_1") || metadata.issueDate || "";
    const saleDate = firstText(doc, "P_6") || issueDate;
    const dueDate = firstText(doc, "Termin") || issueDate;
    const invoiceNumber = firstText(doc, "P_2") || metadata.invoiceNumber || metadata.ksefNumber;
    const buyerNip = firstText(buyerNode || doc, "NIP") || metadata.buyer?.identifier?.value || "";
    const buyerName = firstText(buyerNode || doc, "Nazwa") || metadata.buyer?.name || "";
    const sellerNip = firstText(sellerNode || doc, "NIP") || metadata.seller?.nip || "";
    const orderNumber = firstText(doc, "NrZamowienia");
    const quantity = Number.parseFloat((firstText(doc, "P_8B") || "0").replace(",", "."));
    const companyMatch = companies.find(item => item.nip === buyerNip) || null;
    const importedAt = Date.now();

    const netto = toGrosze(firstText(doc, "P_13_1") || metadata.netAmount);
    const vat = toGrosze(firstText(doc, "P_14_1") || metadata.vatAmount);
    const brutto = toGrosze(firstText(doc, "P_15") || metadata.grossAmount);

    return {
        id: `ksef:${metadata.ksefNumber}`,
        source: "ksef",
        nr: invoiceNumber,
        key: companyMatch?.key || "",
        tag: companyMatch?.tag || "KSeF",
        company: buyerName || companyMatch?.name || metadata.buyer?.name || "Brak nabywcy",
        nip: buyerNip || metadata.buyer?.identifier?.value || "",
        sellerNip,
        zam: orderNumber,
        hoursCent: Number.isFinite(quantity) ? Math.round(quantity * 100) : 0,
        rateGr: 0,
        netto,
        vat,
        brutto,
        saleDate,
        issueDate,
        dueDate,
        createdAt: importedAt,
        importedAt,
        ksefNumber: metadata.ksefNumber,
        invoiceHash: metadata.invoiceHash || "",
        invoiceType: metadata.invoiceType || "",
        currency: metadata.currency || "PLN",
        xml
    };
}

async function queryIssuedMetadata(accessToken, contextNip, from, to) {
    return ksefFetch("/invoices/query/metadata?sortOrder=Desc&pageOffset=0&pageSize=10", {
        method: "POST",
        bearer: accessToken,
        body: JSON.stringify({
            subjectType: "Subject1",
            sellerNip: contextNip,
            dateRange: {
                dateType: "Issue",
                from: toKsefDateStart(from),
                to: toKsefDateEnd(to)
            }
        })
    });
}

async function downloadInvoiceXml(accessToken, ksefNumber) {
    return ksefFetch(`/invoices/ksef/${encodeURIComponent(ksefNumber)}`, {
        bearer: accessToken,
        responseType: "text"
    });
}

export async function importIssuedInvoices({ token, contextNip, from, to, companies, onProgress }) {
    const accessToken = await authenticateWithToken(token, contextNip, onProgress);
    onProgress?.("Pobieram metadane wystawionych faktur...");
    const metadataResponse = await queryIssuedMetadata(accessToken, contextNip, from, to);
    const metadataItems = metadataResponse.invoices || [];
    const items = [];

    for (let index = 0; index < metadataItems.length; index += 1) {
        const metadata = metadataItems[index];
        const label = metadata.invoiceNumber || metadata.ksefNumber;
        onProgress?.(`Pobieram XML ${index + 1}/${metadataItems.length}: ${label}`);
        try {
            const xml = await downloadInvoiceXml(accessToken, metadata.ksefNumber);
            const record = parseImportedInvoice(xml, metadata, companies);
            items.push({ ok: true, record, metadata });
        } catch (error) {
            items.push({ ok: false, metadata, error: error.message || String(error) });
        }
    }

    return {
        hasMore: !!metadataResponse.hasMore,
        totalFetched: metadataItems.length,
        items
    };
}