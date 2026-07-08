import { parseImportedInvoiceXml } from "./ksef.js?v=20260709a";

let zipModulePromise = null;

function isXmlFileName(name) {
    return /\.xml$/i.test(name || "");
}

function isZipFile(file) {
    return /\.zip$/i.test(file?.name || "") || String(file?.type || "").includes("zip");
}

async function getZipModule() {
    if (!zipModulePromise) {
        zipModulePromise = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm").then(module => module.default || module);
    }
    return zipModulePromise;
}

async function expandInputFiles(files, onProgress) {
    const queue = [];
    const failures = [];

    for (const file of files) {
        if (isZipFile(file)) {
            onProgress?.(`Rozpakowuję ZIP: ${file.name}`);
            try {
                const JSZip = await getZipModule();
                const archive = await JSZip.loadAsync(file);
                const entries = Object.values(archive.files)
                    .filter(entry => !entry.dir && isXmlFileName(entry.name));

                if (!entries.length) {
                    failures.push({
                        ok: false,
                        label: file.name,
                        meta: "ZIP",
                        error: "Paczka ZIP nie zawiera żadnych plików XML."
                    });
                    continue;
                }

                entries.forEach(entry => {
                    queue.push({
                        label: entry.name.split("/").pop() || entry.name,
                        meta: `${file.name} -> ${entry.name}`,
                        read: () => entry.async("string")
                    });
                });
            } catch (error) {
                failures.push({
                    ok: false,
                    label: file.name,
                    meta: "ZIP",
                    error: `Nie udało się odczytać ZIP: ${error.message || error}`
                });
            }
            continue;
        }

        if (isXmlFileName(file.name)) {
            queue.push({
                label: file.name,
                meta: "XML",
                read: () => file.text()
            });
            continue;
        }

        failures.push({
            ok: false,
            label: file.name,
            meta: "Nieobsługiwany format",
            error: "Obsługiwane są tylko pliki .xml oraz .zip."
        });
    }

    return { queue, failures };
}

export async function importInvoicesFromFiles({ files, companies, onProgress }) {
    const { queue, failures } = await expandInputFiles(files, onProgress);
    const items = [...failures];

    for (let index = 0; index < queue.length; index += 1) {
        const entry = queue[index];
        onProgress?.(`Przetwarzam plik ${index + 1}/${queue.length}: ${entry.label}`);
        try {
            const xml = await entry.read();
            const record = parseImportedInvoiceXml(xml, companies);
            items.push({
                ok: true,
                label: entry.label,
                meta: entry.meta,
                record
            });
        } catch (error) {
            items.push({
                ok: false,
                label: entry.label,
                meta: entry.meta,
                error: error.message || String(error)
            });
        }
    }

    return { items };
}