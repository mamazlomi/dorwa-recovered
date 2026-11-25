"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// A table where every cell is editable, used across the Dorva panel. Changed
// cells turn yellow; ticked rows can get one change at once; "Save all changes"
// sends only what changed, and rows the server refuses stay red with the reason.
export type Val = string | boolean;
export type GridCol = {
  key: string; label: string; kind: "number" | "bool" | "select";
  options?: Record<string, string>; placeholder?: string; min?: number; max?: number; step?: number;
  /** a filled cell may be emptied (empty = inherit / default) */ nullable?: boolean;
};
export type GridAction = { key: string; label: string; col: string; op: "set" | "add" | "pct" | "clear" | "on" | "off" | "pick"; placeholder?: string };
export type GridFilter = { key: string; label: string; options: Record<string, string> };
export type GridRowData = {
  id: string; title: string; sub?: string; note?: string; href?: string;
  /** extra text the search box matches (codes, brand…) */ search?: string;
  /** filter tags; several values of one tag are joined with "|" */
  values: Record<string, Val>; info: Record<string, string>; tags?: Record<string, string>;
};
export type GridSaveItem = { id: string; values: Record<string, Val | null> };
export type GridResult = { ok: number; errors: { id: string | null; code: string }[] };
type T = Record<string, string>;

export function BulkGrid({ rows, cols, infos, actions, filters = [], texts: L, errors: E, save, canEdit = true, pageSize = 100,
  initialFilters = {}, defaultHidden = [], storageKey }: {
  rows: GridRowData[]; cols: GridCol[]; infos: { key: string; label: string }[]; actions: GridAction[];
  filters?: GridFilter[]; texts: T; errors: T; save: (items: GridSaveItem[]) => Promise<GridResult>; canEdit?: boolean; pageSize?: number;
  /** filters already set when the page opens (e.g. from a link) */ initialFilters?: Record<string, string>;
  /** columns hidden until the user shows them; the choice is remembered in this browser under storageKey */
  defaultHidden?: string[]; storageKey?: string;
}) {
  const router = useRouter();
  const orig = useMemo(() => new Map(rows.map((r) => [r.id, r.values])), [rows]);
  const failed = useRef<Map<string, Record<string, Val>>>(new Map());
  const [vals, setVals] = useState(() => new Map(orig));
  useEffect(() => {
    const n = new Map(orig);
    failed.current.forEach((v, id) => { if (n.has(id)) n.set(id, v); });
    setVals(n);
  }, [orig]);
  const [q, setQ] = useState("");
  const [f, setF] = useState<Record<string, string>>(initialFilters);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(defaultHidden));
  useEffect(() => {
    if (!storageKey) return;
    try { const v = window.localStorage.getItem(storageKey); if (v) setHidden(new Set(JSON.parse(v) as string[])); } catch { /* storage unavailable */ }
  }, [storageKey]);
  const toggleCol = (k: string) => setHidden((h) => {
    const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k);
    try { if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify([...n])); } catch { /* storage unavailable */ }
    return n;
  });
  const shownCols = cols.filter((c) => !hidden.has(c.key));
  const shownInfos = infos.filter((c) => !hidden.has(c.key));
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [action, setAction] = useState(actions[0]?.key ?? "");
  const [amount, setAmount] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const dirtyKeys = (id: string) => cols.filter((c) => vals.get(id)?.[c.key] !== orig.get(id)?.[c.key]).map((c) => c.key);
  const changed = rows.filter((r) => dirtyKeys(r.id).length > 0);
  const changedSet = new Set(changed.map((r) => r.id));
  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!needle || `${r.title} ${r.sub ?? ""} ${r.search ?? ""}`.toLowerCase().includes(needle))
    && filters.every((fl) => !f[fl.key] || (r.tags?.[fl.key] ?? "").split("|").includes(f[fl.key])) && (!onlyChanged || changedSet.has(r.id)));
  const activeFilters = Object.values(f).filter(Boolean).length;
  const visible = shown.slice(0, limit);
  const allShown = shown.length > 0 && shown.every((r) => sel.has(r.id));
  const act = actions.find((a) => a.key === action);
  const col = cols.find((c) => c.key === act?.col);

  const set = (id: string, k: string, v: Val) => setVals((m) => { const n = new Map(m); n.set(id, { ...n.get(id)!, [k]: v }); return n; });
  const apply = () => {
    if (!act || !col) return;
    const a = Number(amount);
    if (["set", "add", "pct"].includes(act.op) && (amount.trim() === "" || !Number.isFinite(a))) return;
    if (act.op === "pick" && !amount) return;
    setVals((m) => {
      const n = new Map(m);
      shown.filter((r) => sel.has(r.id)).forEach((r) => {
        const v = { ...n.get(r.id)! };
        const cur = Number(v[col.key]);
        const clamp = (x: number) => Math.min(col.max ?? Infinity, Math.max(col.min ?? -Infinity, x));
        if (act.op === "set") v[col.key] = String(clamp(a));
        if (act.op === "add") v[col.key] = String(clamp((Number.isFinite(cur) ? cur : 0) + a));
        if (act.op === "pct" && v[col.key] !== "" && Number.isFinite(cur)) v[col.key] = String(clamp(Math.round(cur * (1 + a / 100))));
        if (act.op === "clear") v[col.key] = "";
        if (act.op === "on") v[col.key] = true;
        if (act.op === "off") v[col.key] = false;
        if (act.op === "pick") v[col.key] = amount;
        n.set(r.id, v);
      });
      return n;
    });
    setMsg({ ok: true, text: L.applied.replace("{n}", String([...sel].filter((id) => shown.some((r) => r.id === id)).length)) });
  };
  const doSave = () => start(async () => {
    const items: GridSaveItem[] = changed.map((r) => ({
      id: r.id, values: Object.fromEntries(dirtyKeys(r.id).map((k) => {
        const v = vals.get(r.id)![k];
        return [k, v === "" ? null : v];
      })),
    }));
    const res = await save(items);
    const e: Record<string, string> = {};
    res.errors.forEach((x) => { if (x.id) e[x.id] = E[x.code] ?? E.unknown; });
    setErrs(e);
    const general = res.errors.find((x) => !x.id);
    setMsg(general ? { ok: false, text: E[general.code] ?? E.unknown }
      : { ok: res.errors.length === 0, text: L.savedN.replace("{n}", String(res.ok)) + (res.errors.length ? " " + L.failedN.replace("{n}", String(res.errors.length)) : "") });
    failed.current = new Map([...vals].filter(([id]) => e[id]));
    if (res.ok) router.refresh();
  });

  const inputCls = (dirty: boolean, bad: boolean) =>
    `input w-24 py-1 text-sm ${bad ? "border-red-500 bg-red-50" : dirty ? "border-amber-400 bg-amber-50 font-semibold" : ""}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="min-w-48 flex-1"><span className="label">{L.search}</span>
          <input type="search" className="input py-1.5" value={q} onChange={(e) => { setQ(e.target.value); setLimit(pageSize); }} /></label>
        {filters.map((fl) => (
          <label key={fl.key}><span className="label">{fl.label}</span>
            <select className="input py-1.5" value={f[fl.key] ?? ""} onChange={(e) => { setF({ ...f, [fl.key]: e.target.value }); setLimit(pageSize); }}>
              <option value="">{L.all}</option>
              {Object.entries(fl.options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
        ))}
        <label className="flex items-center gap-2 pb-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> {L.onlyChanged}</label>
        {activeFilters > 0 && (
          <button type="button" className="pb-2 text-xs text-brand-700 hover:underline" onClick={() => { setF({}); setQ(""); setLimit(pageSize); }}>
            {L.clearFilters ?? "×"}
          </button>
        )}
        {storageKey && (
          <details className="relative pb-1">
            <summary className="btn-ghost cursor-pointer list-none py-1.5 text-sm">{L.columns ?? "⋯"}</summary>
            <div className="absolute end-0 z-30 mt-1 w-64 space-y-1 rounded-xl border border-line bg-white p-3 shadow-lg">
              {[...cols, ...infos].map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                </label>
              ))}
            </div>
          </details>
        )}
      </div>

      {canEdit && (
        <div className="sticky top-16 z-20 space-y-2 rounded-xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={changed.length ? "font-bold text-amber-800" : "text-muted"}>{L.changes.replace("{n}", String(changed.length))}</span>
            <button type="button" className="btn py-1.5" disabled={!changed.length || pending} onClick={doSave}>{pending ? L.saving : L.saveAll}</button>
            <button type="button" className="btn-ghost py-1.5" disabled={!changed.length || pending}
              onClick={() => { failed.current = new Map(); setVals(new Map(orig)); setErrs({}); setMsg(null); }}>{L.undo}</button>
            {msg && <span role="status" className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-700"}`}>{msg.text}</span>}
          </div>
          {sel.size > 0 && actions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-2 text-sm">
              <span className="font-semibold">{L.selected.replace("{n}", String(sel.size))}</span>
              <select className="input w-auto py-1 text-sm" value={action} onChange={(e) => { setAction(e.target.value); setAmount(""); }} aria-label={L.action}>
                {actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              {act && ["set", "add", "pct"].includes(act.op) && (
                <input type="number" className="input w-28 py-1 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={act.placeholder} aria-label={L.amount} />
              )}
              {act?.op === "pick" && col?.options && (
                <select className="input w-auto py-1 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={L.amount}>
                  <option value="">{L.choose}</option>
                  {Object.entries(col.options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
              <button type="button" className="btn py-1" onClick={apply}>{L.apply}</button>
              <button type="button" className="text-xs text-muted hover:underline" onClick={() => setSel(new Set())}>{L.clearSel}</button>
            </div>
          )}
          <p className="text-xs text-muted">{L.help}</p>
        </div>
      )}

      <p className="text-xs text-muted">{L.shown.replace("{n}", String(shown.length)).replace("{m}", String(rows.length))}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              {canEdit && <th className="w-8 py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={L.selectAll} checked={allShown}
                onChange={(e) => setSel((s) => { const n = new Set(s); shown.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} /></th>}
              <th className="py-2 text-start">{L.item}</th>
              {shownCols.map((c) => <th key={c.key} className="text-start">{c.label}</th>)}
              {shownInfos.map((c) => <th key={c.key} className="text-start">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const v = vals.get(r.id) ?? r.values;
              const dk = dirtyKeys(r.id);
              return (
                <tr key={r.id} className={`border-b border-line align-top last:border-0 ${errs[r.id] ? "bg-red-50" : dk.length ? "bg-amber-50/40" : ""}`}>
                  {canEdit && <td className="py-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={r.title} checked={sel.has(r.id)}
                    onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
                  <td className="py-2 pe-2">
                    {r.href ? <a href={r.href} className="hover:text-brand-700 hover:underline">{r.title}</a> : r.title}
                    {r.sub && <p className="text-xs text-muted">{r.sub}</p>}
                    {r.note && <p className="text-xs text-amber-900">{r.note}</p>}
                    {errs[r.id] && <p className="text-xs font-semibold text-red-700">{errs[r.id]}</p>}
                  </td>
                  {shownCols.map((c) => {
                    const val = v[c.key];
                    const dirty = dk.includes(c.key);
                    if (!canEdit) return <td key={c.key} className="py-1.5">{c.kind === "bool" ? (val ? "✓" : "—") : c.kind === "select" ? c.options?.[String(val)] ?? String(val) : String(val || c.placeholder || "")}</td>;
                    const bad = c.kind === "number" && val !== "" && ((c.max != null && Number(val) > c.max) || (c.min != null && Number(val) < c.min));
                    return (
                      <td key={c.key} className="py-1.5 pe-1">
                        {c.kind === "bool" ? (
                          <input type="checkbox" className={`h-5 w-5 accent-brand-600 ${dirty ? "ring-2 ring-amber-400" : ""}`} checked={!!val}
                            onChange={(e) => set(r.id, c.key, e.target.checked)} aria-label={`${c.label} — ${r.title}`} />
                        ) : c.kind === "select" ? (
                          <select className={`${inputCls(dirty, false)} w-auto`} value={String(val)} onChange={(e) => set(r.id, c.key, e.target.value)} aria-label={`${c.label} — ${r.title}`}>
                            {Object.entries(c.options ?? {}).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
                          </select>
                        ) : (
                          <input type="number" className={inputCls(dirty, bad)} value={String(val)} placeholder={c.placeholder} min={c.min} max={c.max} step={c.step}
                            onChange={(e) => set(r.id, c.key, e.target.value)} aria-label={`${c.label} — ${r.title}`} />
                        )}
                      </td>
                    );
                  })}
                  {shownInfos.map((c) => <td key={c.key} className="py-2 text-xs">{r.info[c.key]}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <button type="button" className="btn-ghost w-full text-sm" onClick={() => setLimit((n) => n + pageSize * 2)}>
          {L.more.replace("{n}", String(shown.length - limit))}
        </button>
      )}
    </div>
  );
}
