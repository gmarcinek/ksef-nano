import { SELLER, BUYER_ADDR, NRB } from './data.js';
import { fmtDot } from './calc.js';

export function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildXml(rec) {
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, ".00000Z");
    return `<?xml version="1.0" encoding="utf-8"?>`
        + `<Faktura xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">`
        + `<Naglowek>`
        +   `<KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>`
        +   `<WariantFormularza>3</WariantFormularza>`
        +   `<DataWytworzeniaFa>${ts}</DataWytworzeniaFa>`
        +   `<SystemInfo>Aplikacja Podatnika KSeF</SystemInfo>`
        + `</Naglowek>`
        + `<Podmiot1>`
        +   `<DaneIdentyfikacyjne><NIP>${SELLER.nip}</NIP><Nazwa>${esc(SELLER.name)}</Nazwa></DaneIdentyfikacyjne>`
        +   `<Adres><KodKraju>PL</KodKraju><AdresL1>${esc(SELLER.addr)}</AdresL1></Adres>`
        + `</Podmiot1>`
        + `<Podmiot2>`
        +   `<DaneIdentyfikacyjne><NIP>${rec.nip}</NIP><Nazwa>${esc(rec.company)}</Nazwa></DaneIdentyfikacyjne>`
        +   `<Adres><KodKraju>PL</KodKraju><AdresL1>${esc(BUYER_ADDR)}</AdresL1></Adres>`
        +   `<JST>2</JST><GV>2</GV>`
        + `</Podmiot2>`
        + `<Fa>`
        +   `<KodWaluty>PLN</KodWaluty>`
        +   `<P_1>${rec.issueDate}</P_1><P_1M>Warszawa</P_1M>`
        +   `<P_2>${rec.nr}</P_2>`
        +   `<P_6>${rec.saleDate}</P_6>`
        +   `<P_13_1>${fmtDot(rec.netto)}</P_13_1>`
        +   `<P_14_1>${fmtDot(rec.vat)}</P_14_1>`
        +   `<P_15>${fmtDot(rec.brutto)}</P_15>`
        +   `<Adnotacje>`
        +     `<P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A>`
        +     `<Zwolnienie><P_19N>1</P_19N></Zwolnienie>`
        +     `<NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>`
        +     `<P_23>2</P_23>`
        +     `<PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>`
        +   `</Adnotacje>`
        +   `<RodzajFaktury>VAT</RodzajFaktury>`
        +   `<FaWiersz>`
        +     `<NrWierszaFa>1</NrWierszaFa>`
        +     `<P_7>Prace dewelopera</P_7>`
        +     `<P_8A>godzina</P_8A>`
        +     `<P_8B>${(rec.hoursCent / 100).toFixed(2)}</P_8B>`
        +     `<P_9A>${(rec.rateGr / 100).toFixed(2)}</P_9A>`
        +     `<P_11>${fmtDot(rec.netto)}</P_11>`
        +     `<P_12>23</P_12>`
        +   `</FaWiersz>`
        +   `<Platnosc>`
        +     `<TerminPlatnosci><Termin>${rec.dueDate}</Termin></TerminPlatnosci>`
        +     `<FormaPlatnosci>6</FormaPlatnosci>`
        +     `<RachunekBankowy><NrRB>${NRB}</NrRB></RachunekBankowy>`
        +   `</Platnosc>`
        +   `<WarunkiTransakcji>`
        +     `<Zamowienia><NrZamowienia>${rec.zam}</NrZamowienia></Zamowienia>`
        +   `</WarunkiTransakcji>`
        + `</Fa>`
        + `</Faktura>`;
}

export function download(name, content) {
    const blob = new Blob([content], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const fname = rec => `Wersja_robocza_${rec.nr.replace("/", "_")}_NN_${rec.key}.xml`;
