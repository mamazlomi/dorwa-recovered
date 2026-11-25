"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Admin rule builder for collections. Groups are joined by OR; inside a group
// every condition must hold (AND); several values in one condition = any (OR).
// The result is posted as JSON in a hidden input.

export type RuleKey = { key: string; label: string; options: { value: string; label: string; count: number }[] };
export type RuleTexts = {
  group: string; or: string; and: string; addGroup: string; removeGroup: string;
  addCondition: string; chooseKey: string; removeCondition: string; searchValues: string; noRules: string;
  livePreview: string; liveCount: string; liveLoading: string; liveError: string; notInStock: string;
};
type PreviewItem = { id: string; name: string; price: number | null; discount: number; inStock: boolean };
type Preview = { include: string[]; exclude: string[]; pharmacyId?: string | null };
type Group = Record<string, string[]>;

const norm = (s: string) =>
  s.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim();
const fill = (tpl: string, x: string) => tpl.replace("{x}", x);

function Condition({ k, selected, onChange, onRemove, texts, fmt }: {
  k: RuleKey; selected: string[]; onChange: (v: string[]) => void; onRemove: () => void;
  texts: RuleTexts; fmt: (n: number) => string;
}) {
  const [term, setTerm] = useState("");
  const labelOf = (v: string) => k.options.find((o) => o.value === v)?.label ?? v;
  const matches = useMemo(() => {
    const t = norm(term);
    return k.options.filter((o) => !selected.includes(o.value) && (!t || norm(o.label).includes(t) || norm(o.value).includes(t))).slice(0, 40);
  }, [term, k.options, selected]);
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{k.label}</span>
        <button type="button" onClick={onRemove} className="text-xs text-red-700 hover:underline">{texts.removeCondition}</button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {selected.map((v) => (
          <button key={v} type="button" onClick={() => onChange(selected.filter((x) => x !== v))}
            className="chip gap-1 hover:bg-brand-100">{labelOf(v)} <span aria-hidden>×</span></button>
        ))}
      </div>
      <input type="search" value={term} onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
        placeholder={texts.searchValues} aria-label={`${texts.searchValues}: ${k.label}`} className="input mb-2 py-1.5 text-xs" />
      <ul className="max-h-48 space-y-0.5 overflow-y-auto">
        {matches.map((o) => (
          <li key={o.value}>
            <button type="button" onClick={() => onChange([...selected, o.value])}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-start text-sm hover:bg-brand-50">
              <span className="truncate">+ {o.label}</span>
              <span className="text-xs text-muted">{fmt(o.count)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RuleBuilder({ name, initial, keys, texts, locale, disabled, preview }: {
  name: string; initial: Group[]; keys: RuleKey[]; texts: RuleTexts; locale: string; disabled?: boolean;
  /** live preview of the unsaved rules (needs the surrounding form's only_discounted checkbox, if any) */
  preview?: Preview;
}) {
  const [groups, setGroups] = useState<Group[]>(initial);
  const intl = locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US";
  const fmt = (n: number) => n.toLocaleString(intl);
  const box = useRef<HTMLFieldSetElement>(null);
  const [live, setLive] = useState<{ state: "idle" | "loading" | "error" | "ok"; total: number; items: PreviewItem[] }>(
    { state: "idle", total: 0, items: [] });
  const [tick, setTick] = useState(0);
  const rulesKey = JSON.stringify(groups);

  // re-count when the "only discounted" box in the same form changes
  useEffect(() => {
    const form = box.current?.form;
    if (!form || !preview) return;
    const on = (e: Event) => { if ((e.target as HTMLInputElement)?.name === "only_discounted") setTick((n) => n + 1); };
    form.addEventListener("change", on);
    return () => form.removeEventListener("change", on);
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLive((l) => ({ ...l, state: "loading" }));
      const form = box.current?.form;
      const od = form?.elements.namedItem("only_discounted");
      try {
        const res = await fetch("/api/collections/preview", {
          method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rules: JSON.parse(rulesKey), include: preview.include, exclude: preview.exclude,
            pharmacyId: preview.pharmacyId ?? null, locale,
            onlyDiscounted: od instanceof HTMLInputElement ? od.checked : false,
          }),
        });
        if (!res.ok) throw new Error();
        const j = await res.json();
        setLive({ state: "ok", total: j.total ?? 0, items: j.items ?? [] });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setLive({ state: "error", total: 0, items: [] });
      }
    }, 450);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [rulesKey, tick, preview, locale]);
  const keyOf = (k: string) => keys.find((x) => x.key === k) ?? { key: k, label: k, options: [] };
  const setGroup = (i: number, g: Group) => setGroups(groups.map((x, n) => (n === i ? g : x)));
  const clean = groups.map((g) => Object.fromEntries(Object.entries(g).filter(([, v]) => v.length > 0)))
    .filter((g) => Object.keys(g).length > 0);

  return (
    <fieldset ref={box} disabled={disabled} className="space-y-3">
      <input type="hidden" name={name} value={JSON.stringify(clean)} />
      {groups.length === 0 && <p className="text-sm text-muted">{texts.noRules}</p>}
      {groups.map((g, i) => (
        <div key={i}>
          {i > 0 && <p className="my-2 text-center text-xs font-bold text-brand-700">— {texts.or} —</p>}
          <div className="space-y-2 rounded-2xl bg-brand-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-extrabold">{fill(texts.group, fmt(i + 1))}</span>
              <button type="button" onClick={() => setGroups(groups.filter((_, n) => n !== i))}
                className="text-xs text-red-700 hover:underline">{texts.removeGroup}</button>
            </div>
            {Object.keys(g).map((k, n) => (
              <div key={k}>
                {n > 0 && <p className="my-1 text-center text-xs text-muted">{texts.and}</p>}
                <Condition k={keyOf(k)} selected={g[k]} texts={texts} fmt={fmt}
                  onChange={(v) => setGroup(i, { ...g, [k]: v })}
                  onRemove={() => { const c = { ...g }; delete c[k]; setGroup(i, c); }} />
              </div>
            ))}
            <select value="" aria-label={texts.addCondition} className="input w-auto py-1.5 text-sm"
              onChange={(e) => { if (e.target.value) setGroup(i, { ...g, [e.target.value]: [] }); }}>
              <option value="">{texts.addCondition} — {texts.chooseKey}</option>
              {keys.filter((k) => !(k.key in g)).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setGroups([...groups, {}])} className="btn-ghost text-sm">{texts.addGroup}</button>
      {preview && (
        <div className="rounded-2xl border border-brand-200 bg-white p-3" aria-live="polite">
          <p className="mb-2 text-sm font-bold">
            {texts.livePreview}:{" "}
            <span className="text-brand-700">
              {live.state === "loading" ? texts.liveLoading : live.state === "error" ? texts.liveError : fill(texts.liveCount, fmt(live.total))}
            </span>
          </p>
          <ul className={`space-y-1 text-sm ${live.state === "loading" ? "opacity-50" : ""}`}>
            {live.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-2">
                <span className="truncate">{it.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {!it.inStock ? texts.notInStock : it.discount > 0 ? `${fmt(it.discount)}٪` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
