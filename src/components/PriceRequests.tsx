"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decidePrices } from "@/lib/bulkActions";

type Req = { id: string; pharmacy: string; product: string; current: string; requested: string; dorva: string; change: string; up: boolean; when: string };
type T = Record<string, string>;

// Dorva's queue of pharmacy price changes: tick and approve (for that pharmacy
// or for all pharmacies) or reject with a reason, many at once.
export function PriceRequests({ rows, texts: L }: { rows: Req[]; texts: T }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) return <p className="text-sm text-muted">{L.empty}</p>;
  const all = rows.every((r) => sel.has(r.id));
  const run = (approve: boolean, scope: "this" | "all") => {
    if (!sel.size) return;
    if (!approve && !note.trim()) { setMsg({ ok: false, text: L.noteNeeded }); return; }
    if (approve && scope === "all" && !window.confirm(L.confirmAll)) return;
    start(async () => {
      const r = await decidePrices([...sel], approve, scope, note.trim());
      setMsg(r.error ? { ok: false, text: r.error === "note" ? L.noteNeeded : r.error } : { ok: true, text: L.done.replace("{n}", String(r.n)) });
      if (!r.error) { setSel(new Set()); setNote(""); router.refresh(); }
    });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm">
        <span className="font-semibold">{L.selected.replace("{n}", String(sel.size))}</span>
        <button type="button" className="btn py-1.5" disabled={!sel.size || pending} onClick={() => run(true, "this")}>{L.approveThis}</button>
        <button type="button" className="btn-ghost py-1.5" disabled={!sel.size || pending} onClick={() => run(true, "all")}>{L.approveAll}</button>
        <input className="input w-64 py-1.5" placeholder={L.notePh} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn-ghost py-1.5 text-red-700" disabled={!sel.size || pending} onClick={() => run(false, "this")}>{L.reject}</button>
        {msg && <span role="status" className={msg.ok ? "text-brand-700" : "text-red-700"}>{msg.text}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="w-8 py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={L.selectAll} checked={all}
                onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              <th className="py-2 text-start">{L.pharmacy}</th><th className="text-start">{L.product}</th>
              <th className="text-start">{L.current}</th><th className="text-start">{L.requested}</th><th className="text-start">{L.change}</th>
              <th className="text-start">{L.dorva}</th><th className="text-start">{L.when}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={r.product} checked={sel.has(r.id)}
                  onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                <td className="py-2">{r.pharmacy}</td><td>{r.product}</td><td>{r.current}</td>
                <td className="font-semibold">{r.requested}</td>
                <td className={r.up ? "text-red-700" : "text-brand-700"}>{r.change}</td>
                <td>{r.dorva}</td><td className="text-xs text-muted">{r.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
