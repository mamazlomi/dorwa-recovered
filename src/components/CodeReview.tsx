"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewCodes } from "@/lib/toolActions";

type Row = { id: string; code: string; product: string; catalogGtin: string; pharmacy: string; agree: number; conflicts: number; when: string };
type T = Record<string, string>;

// Dorva's queue of barcodes suggested by pharmacies: tick, approve or reject in bulk.
export function CodeReview({ rows, texts: L }: { rows: Row[]; texts: T }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) return <p className="text-sm text-muted">{L.empty}</p>;
  const run = (approve: boolean) => start(async () => {
    const r = await reviewCodes([...sel], approve, note.trim());
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: L.done.replace("{n}", String(r.n)) });
    if (!r.error) { setSel(new Set()); setNote(""); router.refresh(); }
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm">
        <span className="font-semibold">{L.selected.replace("{n}", String(sel.size))}</span>
        <button type="button" className="btn py-1.5" disabled={!sel.size || pending} onClick={() => run(true)}>{L.approve}</button>
        <input className="input w-56 py-1.5" placeholder={L.notePh} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn-ghost py-1.5 text-red-700" disabled={!sel.size || pending} onClick={() => run(false)}>{L.reject}</button>
        {msg && <span role="status" className={msg.ok ? "text-brand-700" : "text-red-700"}>{msg.text}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="w-8 py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={L.selectAll} checked={rows.every((r) => sel.has(r.id))}
                onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              <th className="py-2 text-start">{L.code}</th><th className="text-start">{L.product}</th><th className="text-start">{L.catalogGtin}</th>
              <th className="text-start">{L.pharmacy}</th><th className="text-start">{L.agree}</th><th className="text-start">{L.conflicts}</th><th className="text-start">{L.when}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-line last:border-0 ${r.conflicts > 0 ? "bg-amber-50" : ""}`}>
                <td className="py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={r.code} checked={sel.has(r.id)}
                  onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                <td className="py-2 font-mono" dir="ltr">{r.code}</td><td>{r.product}</td>
                <td className="font-mono text-xs" dir="ltr">{r.catalogGtin || "—"}</td><td>{r.pharmacy}</td>
                <td>{r.agree}</td><td className={r.conflicts > 0 ? "font-bold text-amber-800" : ""}>{r.conflicts}</td>
                <td className="text-xs text-muted">{r.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
