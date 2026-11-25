"use client";

import { useMemo, useState } from "react";
import type { FilterGroup } from "@/lib/filters";

// Filter sidebar: one box per filter, several values per filter (checkboxes),
// a search box inside long filters, and auto-apply on every change.
// It is a plain GET form, so it also works without JavaScript (Apply button).

// Plain strings only (server → client); "{x}" is filled in here.
export type SidebarTexts = {
  title: string; show: string; hide: string; searchIn: string;
  more: string; less: string; noMatch: string; apply: string;
  city: string; allCities: string;
};
type Texts = SidebarTexts;
const fill = (tpl: string, x: string) => tpl.replace("{x}", x);

const VISIBLE = 8;

const norm = (s: string) =>
  s.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim();

function Group({ g, texts, numberFmt }: { g: FilterGroup; texts: Texts; numberFmt: (n: number) => string }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const t = norm(term);
    return t ? g.options.filter((o) => norm(o.label).includes(t)) : g.options;
  }, [term, g.options]);
  // selected values always stay visible
  const limit = open || term ? shown.length : Math.max(VISIBLE, g.selected.length);
  const hidden = shown.length - limit;
  const visible = shown.slice(0, limit);
  // chosen values filtered out by the search box must still be submitted
  const keep = g.selected.filter((v) => !visible.some((o) => o.value === v));

  return (
    <fieldset className="border-b border-line py-4 last:border-b-0">
      <legend className="mb-2 flex w-full items-center justify-between text-sm font-bold">
        <span>{g.label}</span>
        {g.selected.length > 0 && <span className="chip">{numberFmt(g.selected.length)}</span>}
      </legend>
      {g.searchable && g.options.length > VISIBLE && (
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
          placeholder={fill(texts.searchIn, g.label)}
          aria-label={fill(texts.searchIn, g.label)}
          className="input mb-2 py-1.5 text-xs"
        />
      )}
      {keep.map((v) => <input key={`keep-${v}`} type="hidden" name={g.key} value={v} />)}
      <ul className="max-h-72 space-y-1 overflow-y-auto pe-1">
        {visible.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-brand-50">
              <input
                type="checkbox"
                name={g.key}
                value={o.value}
                defaultChecked={g.selected.includes(o.value)}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="size-4 accent-brand-600"
              />
              <span className={`min-w-0 flex-1 truncate ${o.count === 0 ? "text-muted" : ""}`}>{o.label}</span>
              {g.showCounts && <span className="text-xs text-muted">{numberFmt(o.count)}</span>}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-1.5 text-xs text-muted">{texts.noMatch}</li>}
      </ul>
      {!term && (hidden > 0 || open) && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
          {open ? texts.less : fill(texts.more, numberFmt(hidden))}
        </button>
      )}
    </fieldset>
  );
}

export function FacetSidebar({ action, groups, q, city, col, sort, cities, texts, locale, activeCount, top = false }: {
  action: string;
  col?: string;
  sort?: string;
  groups: FilterGroup[];
  q: string;
  city?: string;
  cities?: { value: string; label: string }[];
  texts: Texts;
  locale: string;
  activeCount: number;
  /** theme option: a folding panel above the list instead of a side column */
  top?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const intl = locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US";
  const numberFmt = (n: number) => n.toLocaleString(intl);
  return (
    <aside className={top ? "" : "lg:sticky lg:top-32 lg:self-start"}>
      <button
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        className={`btn-ghost mb-3 w-full ${top ? "sm:w-auto" : "lg:hidden"}`}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? texts.hide : texts.show}
        {activeCount > 0 && <span className="chip">{numberFmt(activeCount)}</span>}
      </button>
      <form
        // remount after navigation so checkboxes always match the URL
        key={JSON.stringify(groups.map((g) => g.selected)) + q + (city ?? "") + (col ?? "") + (sort ?? "")}
        action={action}
        method="get"
        // the panel scrolls on its own, so every filter is reachable without scrolling the products
        className={top ? `card p-4 ${mobileOpen ? "grid" : "hidden"} gap-x-6 sm:grid-cols-2 lg:grid-cols-4` : `card p-4 ${mobileOpen ? "block" : "hidden"} lg:block lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto`}
        onSubmit={(e) => {
          // keep shared URLs clean: empty text/select fields are not sent
          const empty = Array.from(e.currentTarget.elements).filter(
            (el): el is HTMLInputElement | HTMLSelectElement =>
              (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) &&
              !!el.name && el.type !== "checkbox" && el.value === "",
          );
          empty.forEach((el) => (el.disabled = true));
          setTimeout(() => empty.forEach((el) => (el.disabled = false)), 0);
        }}
      >
        <h2 className="mb-1 text-base font-extrabold">{texts.title}</h2>
        {q && <input type="hidden" name="q" value={q} />}
        {col && <input type="hidden" name="col" value={col} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        {cities ? (
          <div className="border-b border-line py-4">
            <label htmlFor="f-city" className="mb-2 block text-sm font-bold">{texts.city}</label>
            <select id="f-city" name="city" defaultValue={city ?? ""} className="input py-2"
              onChange={(e) => e.currentTarget.form?.requestSubmit()}>
              <option value="">{texts.allCities}</option>
              {cities.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        ) : city ? <input type="hidden" name="city" value={city} /> : null}
        {groups.map((g) => <Group key={g.key} g={g} texts={texts} numberFmt={numberFmt} />)}
        <noscript><button className="btn mt-3 w-full">{texts.apply}</button></noscript>
      </form>
    </aside>
  );
}
