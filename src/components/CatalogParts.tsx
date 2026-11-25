import Link from "next/link";
import { hrefWith, type FilterGroup } from "@/lib/filters";

// Server-rendered pieces around a filtered product list.

type State = { q: string; city: string; col?: string; sort?: string; filters: Record<string, string[]> };

/** Chips for every active filter value, each removable, plus "clear all". */
export function ActiveFilters({ base, state, groups, texts }: {
  base: string; state: State; groups: FilterGroup[];
  texts: { clearAll: string; remove: string };
}) {
  const chips = Object.entries(state.filters).flatMap(([key, vals]) => {
    const g = groups.find((x) => x.key === key);
    return vals.map((v) => ({
      key, v,
      label: `${g?.label ? g.label + ": " : ""}${g?.options.find((o) => o.value === v)?.label ?? v}`,
    }));
  });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => {
        const rest = { ...state.filters, [c.key]: state.filters[c.key].filter((x) => x !== c.v) };
        if (rest[c.key].length === 0) delete rest[c.key];
        return (
          <Link key={`${c.key}|${c.v}`} href={hrefWith(base, { ...state, filters: rest })}
            title={texts.remove} aria-label={`${texts.remove}: ${c.label}`}
            className="chip gap-1 hover:bg-brand-100">
            {c.label} <span aria-hidden>×</span>
          </Link>
        );
      })}
      <Link href={hrefWith(base, { q: state.q, city: state.city, col: state.col, sort: state.sort, filters: {} })}
        className="text-xs font-medium text-brand-700 hover:underline">{texts.clearAll}</Link>
    </div>
  );
}

/** Numbered pages around the current one, with first / last and previous / next. */
export function Pager({ base, state, page, pages, texts, fmt, first, last }: {
  base: string; state: State; page: number; pages: number;
  texts: { prev: string; next: string; page: (n: string, t: string) => string };
  fmt: (n: number) => string;
  first?: string; last?: string;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => hrefWith(base, { ...state, page: p });
  const off = "btn-ghost pointer-events-none px-3 py-2 opacity-40";
  // 1 … 4 5 [6] 7 8 … 20
  const around = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pages));
  const nums = [...around].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  nums.forEach((p, i) => { if (i > 0 && p - nums[i - 1] > 1) items.push("gap"); items.push(p); });
  return (
    <nav aria-label={texts.page(fmt(page), fmt(pages))} className="flex flex-wrap items-center justify-center gap-1.5 pt-2 text-sm">
      {first && (page > 1 ? <Link href={href(1)} className="btn-ghost px-3 py-2">{first}</Link> : <span className={off}>{first}</span>)}
      {page > 1 ? <Link href={href(page - 1)} className="btn-ghost px-3 py-2">{texts.prev}</Link> : <span className={off}>{texts.prev}</span>}
      {items.map((it, i) => it === "gap"
        ? <span key={`g${i}`} className="px-1 text-muted">…</span>
        : it === page
          ? <span key={it} aria-current="page" className="inline-flex min-w-10 items-center justify-center rounded-xl bg-brand-600 px-3 py-2 font-bold text-white">{fmt(it)}</span>
          : <Link key={it} href={href(it)} className="btn-ghost min-w-10 px-3 py-2">{fmt(it)}</Link>)}
      {page < pages ? <Link href={href(page + 1)} className="btn-ghost px-3 py-2">{texts.next}</Link> : <span className={off}>{texts.next}</span>}
      {last && (page < pages ? <Link href={href(pages)} className="btn-ghost px-3 py-2">{last}</Link> : <span className={off}>{last}</span>)}
    </nav>
  );
}
