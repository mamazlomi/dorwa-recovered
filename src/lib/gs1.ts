// Reads what a scanner returns: a plain barcode (EAN-13, UPC…) or a GS1 2D code
// (DataMatrix on medicine packs) with GTIN (01), expiry (17), batch (10) and
// serial/UID (21). Accepts raw codes with GS separators and the printed
// "(01)…(17)…" form.
export type Scan = { code: string; gtin?: string; expiry?: string; batch?: string; serial?: string };

const GS = "\u001d";
const FIXED: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "13": 6, "15": 6, "17": 6 };

export function parseScan(raw: string): Scan {
  let s = raw.trim().replace(/^\]d2|^\]Q3|^\]C1/, "");
  if (!s) return { code: "" };
  // printed form: (01)05012345678900(17)271231(10)AB12
  if (/^\(\d{2,4}\)/.test(s)) s = s.replace(/\((\d{2,4})\)/g, (_, ai, off) => (off === 0 ? ai : GS + ai));
  if (!/^(01|02)\d{14}/.test(s) && !s.includes(GS)) return { code: s.replace(/\s/g, "") };
  const out: Scan = { code: s };
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const ai = s.slice(i, i + 2);
    i += 2;
    let val: string;
    if (FIXED[ai] != null) { val = s.slice(i, i + FIXED[ai]); i += FIXED[ai]; }
    else { const end = s.indexOf(GS, i); val = s.slice(i, end < 0 ? s.length : end); i = end < 0 ? s.length : end + 1; }
    if (ai === "01" || ai === "02") out.gtin = val;
    else if (ai === "17" && /^\d{6}$/.test(val)) {
      const yy = Number(val.slice(0, 2)), mm = Number(val.slice(2, 4));
      let dd = Number(val.slice(4, 6));
      if (!dd) dd = new Date(2000 + yy, mm, 0).getDate();       // "00" day = last day of the month
      out.expiry = `20${val.slice(0, 2)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    } else if (ai === "10") out.batch = val;
    else if (ai === "21") out.serial = val;
    else if (!/^\d{2}$/.test(ai)) break;
  }
  out.code = out.gtin ?? s;
  return out;
}
