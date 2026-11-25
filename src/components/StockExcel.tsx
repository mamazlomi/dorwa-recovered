"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyImport, previewImport, type ImportRow } from "@/lib/excelActions";

type T = Record<string, string>;
const fill = (s: string, o: Record<string, string | number>) => Object.entries(o).reduce((a, [k, v]) => a.split(`{${k}}`).join(String(v)), s);

// Download the stock Excel file, upload it back, see what would change, confirm.
export function StockExcel({ pharmacyId, locale, texts: L, errors: E, kinds: K }: { pharmacyId: string; locale: string; texts: T; errors: T; kinds: T }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [same, setSame] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const num = (n: number | null) => (n == null ? "—" : n.toLocaleString(locale === "fa" ? "fa-IR" : "en-US"));

  const upload = (file: File | undefined) => {
    if (!file) return;
    setMsg(null); setRows(null);
    const fd = new FormData();
    fd.set("ph", pharmacyId); fd.set("file", file);
    start(async () => {
      const r = await previewImport(fd);
      if (input.current) input.current.value = "";
      if (!r.ok) { setMsg({ ok: false, text: r.error === "badFile" ? L.badFile : E[r.error] ?? E.unknown }); return; }
      setRows(r.rows); setSame(r.same);
      if (!r.rows.length) setMsg({ ok: true, text: L.nothing });
    });
  };
  const good = rows?.filter((r) => r.kind !== "error") ?? [];
  const confirm = () => start(async () => {
    const res = await applyImport(pharmacyId, good);
    const failed = new Map(res.errors.filter((e) => e.product_id).map((e) => [e.product_id!, e]));
    setMsg({ ok: res.errors.length === 0, text: fill(L.done, { n: res.ok }) + (res.errors.length ? " " + fill(L.failed, { n: res.errors.length }) : "") });
    setRows(failed.size ? (rows ?? []).filter((r) => failed.has(r.product_id)).map((r) => {
      const e = failed.get(r.product_id)!;
      return { ...r, kind: "error" as const, error: e.code, cap: e.cap ? Number(e.cap) : r.cap };
    }) : null);
    router.refresh();
  });
  const errText = (r: ImportRow) => (r.error === "discount" ? fill(E.discount, { n: r.cap ?? 0 }) : E[r.error ?? "unknown"] ?? E.unknown);

  return (
    <section className="card space-y-3">
      <h2 className="font-bold">{L.title}</h2>
      <p className="max-w-3xl text-sm text-muted">{L.intro}</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn" href={`/api/pharmacy/stock-template?ph=${pharmacyId}&locale=${locale}`}>{L.download}</a>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
          onChange={(e) => upload(e.target.files?.[0])} />
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => input.current?.click()}>{pending && !rows ? L.reading : L.upload}</button>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-700"}`}>{msg.text}</p>}
      {rows && rows.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/50 p-3">
          <h3 className="font-semibold">{L.preview}</h3>
          <p className="text-sm">{fill(L.counts, {
            new: rows.filter((r) => r.kind === "new").length, upd: rows.filter((r) => r.kind === "update").length, same,
            err: rows.filter((r) => r.kind === "error").length, price: rows.filter((r) => r.priceChange).length,
          })}</p>
          <div className="max-h-96 overflow-auto rounded-lg border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-muted">
                <tr className="border-b border-line">
                  <th className="p-2 text-start">{L.colProduct}</th><th className="text-start">{L.colKind}</th>
                  <th className="text-start">{L.colQty}</th><th className="text-start">{L.colPrice}</th><th className="text-start">{L.colDisc}</th>
                  <th className="text-start">{L.colNote}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product_id} className={`border-b border-line last:border-0 ${r.kind === "error" ? "bg-red-50" : r.kind === "new" ? "bg-emerald-50/50" : ""}`}>
                    <td className="p-2">{r.name}</td>
                    <td className="text-xs">{K[r.kind]}</td>
                    <td>{r.old.qty !== r.next.qty ? <><s className="text-muted">{num(r.old.qty)}</s> → <b>{num(r.next.qty)}</b></> : num(r.next.qty)}</td>
                    <td>{r.old.price !== r.next.price ? <><s className="text-muted">{r.old.price == null ? L.dorvaPrice : num(r.old.price)}</s> → <b>{r.next.price == null ? L.dorvaPrice : num(r.next.price)}</b></> : (r.next.price == null ? L.dorvaPrice : num(r.next.price))}</td>
                    <td>{(r.old.disc ?? 0) !== r.next.disc ? <><s className="text-muted">{num(r.old.disc ?? 0)}</s> → <b>{num(r.next.disc)}</b></> : num(r.next.disc)}</td>
                    <td className="text-xs">{r.kind === "error" ? <span className="text-red-700">{errText(r)}</span> : r.priceChange ? <span className="text-amber-800">{L.priceWait}</span> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={!good.length || pending} onClick={confirm}>{pending ? L.saving : fill(L.confirm, { n: good.length })}</button>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => { setRows(null); setMsg(null); }}>{L.cancel}</button>
          </div>
        </div>
      )}
    </section>
  );
}
