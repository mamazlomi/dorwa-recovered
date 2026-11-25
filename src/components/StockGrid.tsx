"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveStockBulk, type BulkItem } from "@/lib/stockActions";

export type GridRow = {
  product_id: string; name: string; sub: string; note?: string; status: string; clipped: boolean;
  quantity: number; discount: number; price: number | null; list_price: number | null; cap: number;
  capSource: string; customer: string; customerPct: string; editHref: string;
};
type Vals = { quantity: string; discount: string; price: string };
type T = Record<string, string>;

const toToman = (rial: number | null) => (rial ? String(Math.round(rial / 10)) : "");
const num = (s: string) => (s.trim() === "" ? null : Number(s));

// Inventory table where every cell is editable. Changed cells turn yellow; ticked
// rows can get one change at once (stock, discount, price). Nothing is saved
// until "Save all changes", which saves every changed row in one go.
export function StockGrid({ pharmacyId, rows, texts: L, canEdit, approval = true }: {
  pharmacyId: string; rows: GridRow[]; texts: T; canEdit: boolean;
  /** price changes wait for Dorva (false for Dorva staff) */ approval?: boolean;
}) {
  const router = useRouter();
  const orig = useMemo(() => new Map(rows.map((r) => [r.product_id, {
    quantity: String(r.quantity), discount: String(r.discount), price: toToman(r.price),
  } as Vals])), [rows]);
  const [vals, setVals] = useState<Map<string, Vals>>(() => new Map(orig));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [action, setAction] = useState("stock_set");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // fresh rows from the server: take them, but keep the edits of rows that failed to save
  const failed = useRef<Map<string, Vals>>(new Map());
  useEffect(() => {
    const n = new Map(orig);
    failed.current.forEach((v, id) => { if (n.has(id)) n.set(id, v); });
    setVals(n);
  }, [orig]);
  const changed = rows.filter((r) => {
    const a = vals.get(r.product_id), b = orig.get(r.product_id);
    return a && b && (a.quantity !== b.quantity || a.discount !== b.discount || a.price !== b.price);
  });
  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  const set = (id: string, k: keyof Vals, v: string) =>
    setVals((m) => { const n = new Map(m); n.set(id, { ...n.get(id)!, [k]: v }); return n; });
  const isDirty = (id: string, k: keyof Vals) => vals.get(id)?.[k] !== orig.get(id)?.[k];
  const allShown = rows.length > 0 && rows.every((r) => sel.has(r.product_id));

  const apply = () => {
    const a = Number(amount);
    if (action !== "price_reset" && (amount.trim() === "" || !Number.isFinite(a))) return;
    setVals((m) => {
      const n = new Map(m);
      rows.filter((r) => sel.has(r.product_id)).forEach((r) => {
        const v = { ...n.get(r.product_id)! };
        const q = Number(v.quantity) || 0;
        if (action === "stock_set") v.quantity = String(Math.max(0, Math.round(a)));
        if (action === "stock_add") v.quantity = String(Math.max(0, q + Math.round(a)));
        if (action === "disc_set") v.discount = String(Math.min(100, Math.max(0, a)));
        if (action === "price_set") v.price = String(Math.max(1, Math.round(a)));
        if (action === "price_pct") {
          const base = num(v.price) ?? (r.list_price ? r.list_price / 10 : null);
          if (base) v.price = String(Math.max(1, Math.round(base * (1 + a / 100))));
        }
        if (action === "price_reset") v.price = "";
        n.set(r.product_id, v);
      });
      return n;
    });
    setMsg({ ok: true, text: L.applied.replace("{n}", String(sel.size)) });
  };

  const save = () => start(async () => {
    const items: BulkItem[] = changed.map((r) => {
      const v = vals.get(r.product_id)!;
      const p = num(v.price);
      return { product_id: r.product_id, quantity: Math.max(0, Math.round(Number(v.quantity) || 0)),
        discount_pct: Number(v.discount) || 0, price: p ? Math.round(p) * 10 : null };
    });
    const res = await saveStockBulk(pharmacyId, items);
    const errs: Record<string, string> = {};
    res.errors.forEach((e) => {
      if (!e.product_id) return;
      errs[e.product_id] = e.code === "discount" ? L.errDiscount.replace("{n}", e.cap ?? "0") : L[`err_${e.code}`] ?? L.err_unknown;
    });
    setErrors(errs);
    const general = res.errors.find((e) => !e.product_id);
    setMsg(general ? { ok: false, text: L[`err_${general.code}`] ?? L.err_unknown }
      : { ok: res.errors.length === 0, text: L.savedN.replace("{n}", String(res.ok)) + (res.errors.length ? " " + L.failedN.replace("{n}", String(res.errors.length)) : "")
          + (approval && items.some((it) => it.price != null && it.price !== (rows.find((r) => r.product_id === it.product_id)?.price ?? null)) ? " " + L.pricePending : "") });
    // keep the failed rows' edits on screen; reload the rest from the server
    failed.current = new Map([...vals].filter(([id]) => errs[id]));
    if (res.ok) router.refresh();
  });

  const cell = (dirty: boolean, bad = false) =>
    `input w-24 py-1 text-sm ${bad ? "border-red-500 bg-red-50" : dirty ? "border-amber-400 bg-amber-50 font-semibold" : ""}`;

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="sticky top-16 z-20 space-y-2 rounded-xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={changed.length ? "font-bold text-amber-800" : "text-muted"}>{L.changes.replace("{n}", String(changed.length))}</span>
            <button type="button" className="btn py-1.5" disabled={!changed.length || pending} onClick={save}>{pending ? L.saving : L.saveAll}</button>
            <button type="button" className="btn-ghost py-1.5" disabled={!changed.length || pending} onClick={() => { failed.current = new Map(); setVals(new Map(orig)); setErrors({}); setMsg(null); }}>{L.undo}</button>
            {msg && <span role="status" className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-700"}`}>{msg.text}</span>}
          </div>
          {sel.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-2 text-sm">
              <span className="font-semibold">{L.selected.replace("{n}", String(sel.size))}</span>
              <select className="input w-auto py-1 text-sm" value={action} onChange={(e) => setAction(e.target.value)} aria-label={L.action}>
                {["stock_set", "stock_add", "disc_set", "price_set", "price_pct", "price_reset"].map((k) => <option key={k} value={k}>{L[k]}</option>)}
              </select>
              {action !== "price_reset" && (
                <input type="number" className="input w-28 py-1 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder={L[`${action}_ph`]} aria-label={L.amount} step={action === "disc_set" ? "0.5" : "1"} />
              )}
              <button type="button" className="btn py-1" onClick={apply}>{L.apply}</button>
              <button type="button" className="text-xs text-muted hover:underline" onClick={() => setSel(new Set())}>{L.clearSel}</button>
            </div>
          )}
          <p className="text-xs text-muted">{L.help}</p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              {canEdit && <th className="w-8 py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={L.selectAll} checked={allShown}
                onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.product_id)) : new Set())} /></th>}
              <th className="py-2 text-start">{L.product}</th>
              <th className="text-start">{L.quantity}</th>
              <th className="text-start">{L.price}</th>
              <th className="text-start">{L.discount}</th>
              <th className="text-start">{L.cap}</th>
              <th className="text-start">{L.customer}</th>
              <th className="text-start">{L.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = vals.get(r.product_id) ?? orig.get(r.product_id)!;
              const overCap = Number(v.discount) > r.cap;
              const rowDirty = changed.some((c) => c.product_id === r.product_id);
              return (
                <tr key={r.product_id} className={`border-b border-line align-top last:border-0 ${errors[r.product_id] ? "bg-red-50" : rowDirty ? "bg-amber-50/40" : r.clipped ? "bg-amber-50" : ""}`}>
                  {canEdit && <td className="py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={r.name} checked={sel.has(r.product_id)}
                    onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.product_id); else n.delete(r.product_id); return n; })} /></td>}
                  <td className="py-2 pe-2">
                    <a href={r.editHref} className="hover:text-brand-700 hover:underline">{r.name}</a>
                    <p className="text-xs text-muted">{r.sub}</p>
                    {r.note && <p className="text-xs text-amber-900">{r.note}</p>}
                    {errors[r.product_id] && <p className="text-xs font-semibold text-red-700">{errors[r.product_id]}</p>}
                  </td>
                  {canEdit ? (
                    <>
                      <td className="py-1.5"><input type="number" min={0} className={cell(isDirty(r.product_id, "quantity"))} value={v.quantity}
                        onChange={(e) => set(r.product_id, "quantity", e.target.value)} aria-label={`${L.quantity} — ${r.name}`} /></td>
                      <td className="py-1.5"><input type="number" min={1} className={cell(isDirty(r.product_id, "price"))} value={v.price} placeholder={L.dorvaPrice}
                        onChange={(e) => set(r.product_id, "price", e.target.value)} aria-label={`${L.price} — ${r.name}`} /></td>
                      <td className="py-1.5"><input type="number" min={0} max={100} step="0.5" className={cell(isDirty(r.product_id, "discount"), overCap)} value={v.discount}
                        onChange={(e) => set(r.product_id, "discount", e.target.value)} aria-label={`${L.discount} — ${r.name}`} />
                        {overCap && <p className="text-[11px] text-red-700">{L.overCap}</p>}</td>
                    </>
                  ) : (
                    <><td>{r.quantity}</td><td>{v.price || L.dorvaPrice}</td><td>{r.discount}</td></>
                  )}
                  <td>{r.cap}٪<p className="text-[11px] text-muted">{r.capSource}</p></td>
                  <td>{r.customer}{r.customerPct && <p className="text-[11px] text-muted">{r.customerPct}</p>}</td>
                  <td className="text-xs">{r.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
