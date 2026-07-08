// ═══ matematyka na groszach, ROUND_HALF_UP ══════════════════
export function halfUpDiv(a, b) {
    const q = Math.floor(a / b), r = a - q * b;
    return (r * 2 >= b) ? q + 1 : q;
}

export function calc(hoursCent, rateGr) {
    const netto = halfUpDiv(hoursCent * rateGr, 100);
    const vat   = halfUpDiv(netto * 23, 100);
    return { netto, vat, brutto: netto + vat };
}

export const fmtPL  = gr => (gr / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDot = gr => (gr / 100).toFixed(2);
