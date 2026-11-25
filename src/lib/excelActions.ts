"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cellText, COL_INDEX, normNum, type TemplateRow } from "@/lib/stockExcel";

export type ImportRow = {
  product_id: string; name: string; kind: "new" | "update" | "error";
  old: { qty: number | null; price: number | null; disc: number | null };
  next: { qty: number; price: number | null; disc: number };
  priceChange: boolean; error?: string; cap?: number;
};
export type ImportPreview = { ok: true; rows: ImportRow[]; same: number } | { ok: false; error: string };

/** Reads an uploaded stock file and compares it with the pharmacy's stock. Saves nothing. */
export async function previewImport(formData: FormData): Promise<ImportPreview> {
  const ph = String(formData.get("ph") ?? "");
  const file = formData.get("file");
  if (!/^[0-9a-f-]{36}$/.test(ph) || !(file instanceof File) || file.size === 0 || file.size > 8 * 1024 * 1024) return { ok: false, error: "badFile" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_template", { p_pharmacy: ph });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "unknown" };
  const known = new Map(((data as TemplateRow[]) ?? []).map((r) => [r.product_id, r]));

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { return { ok: false, error: "badFile" }; }
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "badFile" };

  const rows: ImportRow[] = [];
  let same = 0;
  const seen = new Set<string>();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = cellText(row.getCell(COL_INDEX.id).value).trim();
    if (!/^[0-9a-f-]{36}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    const t = known.get(id);
    const name = cellText(row.getCell(COL_INDEX.name).value) || id;
    const rq = normNum(cellText(row.getCell(COL_INDEX.qty).value));
    const rp = normNum(cellText(row.getCell(COL_INDEX.price).value));
    const rd = normNum(cellText(row.getCell(COL_INDEX.disc).value));
    const old = t ? { qty: t.quantity, price: t.own_price != null ? Math.round(Number(t.own_price) / 10) : null, disc: t.own_discount != null ? Number(t.own_discount) : null }
                  : { qty: null, price: null, disc: null };
    const pending = t?.price_requested != null ? Math.round(Number(t.price_requested) / 10) : null;
    const bad = (s: string, int: boolean) => s !== "" && !(int ? /^\d{1,6}$/ : /^\d{1,3}(\.\d{1,2})?$/).test(s);
    const qty = rq === "" ? (old.qty ?? 0) : Number(rq);
    const price = rp === "" ? null : Number(rp);
    const disc = rd === "" ? 0 : Number(rd);
    const base: ImportRow = { product_id: id, name, kind: "update", old, next: { qty, price, disc }, priceChange: false };
    if (!t) { rows.push({ ...base, kind: "error", error: "product" }); return; }
    if (bad(rq, true) || (rp !== "" && !/^\d{1,12}$/.test(rp)) || bad(rd, false) || disc > 100) { rows.push({ ...base, kind: "error", error: "value" }); return; }
    if (disc > Number(t.cap)) { rows.push({ ...base, kind: "error", error: "discount", cap: Number(t.cap) }); return; }
    const inStock = t.quantity != null;
    if (!inStock && qty === 0 && price == null && disc === 0) return;          // untouched product
    const priceChange = price !== (pending ?? old.price);
    const changed = !inStock || qty !== old.qty || priceChange || disc !== (old.disc ?? 0);
    if (!changed) { same++; return; }
    rows.push({ ...base, kind: inStock ? "update" : "new", priceChange: priceChange && price != null });
  });
  return { ok: true, rows, same };
}

/** Saves the confirmed rows of a preview (prices still wait for Dorva's approval). */
export async function applyImport(pharmacyId: string, rows: ImportRow[]): Promise<{ ok: number; errors: { product_id: string | null; code: string; cap?: string | null }[] }> {
  const payload = rows.filter((r) => r.kind !== "error").map((r) => ({
    product_id: r.product_id, quantity: Math.max(0, Math.round(r.next.qty)), discount_pct: r.next.disc,
    price: r.next.price == null ? null : String(Math.round(r.next.price) * 10),
  }));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_import_apply", { p_pharmacy: pharmacyId, p_rows: payload });
  if (error) return { ok: 0, errors: [{ product_id: null, code: error.code === "42501" ? "forbidden" : "unknown" }] };
  revalidatePath("/[locale]/pharmacy/dashboard", "page");
  return data as { ok: number; errors: { product_id: string | null; code: string; cap?: string | null }[] };
}
