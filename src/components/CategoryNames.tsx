"use client";

import { useMemo, useState, useTransition } from "react";
import type { Round4Texts } from "@/i18n/dictionaries/round4";
import { saveCategoryName } from "@/lib/listActions";

type Row = { name_fa: string; name_i18n: Record<string, string>; products: number };

// Dorva panel › Lists: English and Arabic names of every catalog category.
export function CategoryNames({ rows: initial, texts: T }: { rows: Row[]; texts: Round4Texts["cats"] }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<Record<string, "saved" | "error">>({});
  const [pending, start] = useTransition();
  const full = (r: Row) => !!(r.name_i18n.en && r.name_i18n.ar);
  const shown = useMemo(() => rows.filter((r) => (!missing || !full(r)) && (!q || r.name_fa.includes(q.trim())
    || (r.name_i18n.en ?? "").toLowerCase().includes(q.trim().toLowerCase()))), [rows, q, missing]);
  const edit = (fa: string, k: "en" | "ar", v: string) =>
    setRows((rs) => rs.map((r) => (r.name_fa === fa ? { ...r, name_i18n: { ...r.name_i18n, [k]: v } } : r)));
  const save = (r: Row) => start(async () => {
    const res = await saveCategoryName(r.name_fa, r.name_i18n.en ?? "", r.name_i18n.ar ?? "");
    setState((s) => ({ ...s, [r.name_fa]: res === "ok" ? "saved" : "error" }));
  });
  return (
    <section id="categories" className="card space-y-3">
      <h2 className="font-bold">{T.title}</h2>
      <p className="max-w-3xl text-sm text-muted">{T.intro}</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input type="search" className="input max-w-xs py-1" placeholder={T.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} className="h-4 w-4 accent-brand-600" /> {T.missing}</label>
        <span className="text-xs text-muted">{T.count.replace("{n}", String(rows.length)).replace("{m}", String(rows.filter((r) => !full(r)).length))}</span>
      </div>
      <div className="hidden grid-cols-[1fr_1fr_1fr_4rem_auto] gap-2 text-xs text-muted md:grid">
        <span>{T.fa}</span><span>{T.en}</span><span>{T.ar}</span><span>{T.products}</span><span />
      </div>
      <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
        {shown.map((r) => (
          <li key={r.name_fa} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_4rem_auto] md:items-center">
            <span className="text-sm font-medium">{r.name_fa}</span>
            <input dir="ltr" className="input py-1 text-sm" placeholder={T.en} value={r.name_i18n.en ?? ""} onChange={(e) => edit(r.name_fa, "en", e.target.value)} />
            <input dir="rtl" className="input py-1 text-sm" placeholder={T.ar} value={r.name_i18n.ar ?? ""} onChange={(e) => edit(r.name_fa, "ar", e.target.value)} />
            <span className="text-xs text-muted">{r.products}</span>
            <span className="flex items-center gap-2">
              <button type="button" className="btn-ghost py-1 text-xs" disabled={pending} onClick={() => save(r)}>{T.save}</button>
              {state[r.name_fa] && <span className={`text-xs ${state[r.name_fa] === "saved" ? "text-brand-700" : "text-red-700"}`}>{state[r.name_fa] === "saved" ? "✓" : T.error}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
