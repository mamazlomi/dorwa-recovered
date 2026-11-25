import { localized, type Locale } from "@/i18n";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

// Catalog filters shared by the Dorva products page and the pharmacy page.
// The URL carries filters as repeated params (?brand=A&brand=B&section=…), so
// results are shareable and the page works without JavaScript.

type I18n = Record<string, string>;
export type SearchParams = Record<string, string | string[] | undefined>;
export type FilterOption = { value: string; label: string; count: number };
export type FilterGroup = {
  key: string; label: string; searchable: boolean; showCounts: boolean;
  options: FilterOption[]; selected: string[];
};
export type FilterSetting = { facet_key: string; label: I18n; sort: number; searchable: boolean; show_counts: boolean; scope: string };
type OptionRow = { facet_key: string; value_code: string; name_fa: string; name_i18n: I18n; products: number };

export const PAGE_SIZE = 48;
const RESERVED = new Set(["q", "city", "page", "added", "col", "sort"]);
export const SORTS = ["recommended", "bestselling", "most_viewed", "popular", "newest", "cheapest", "discount"] as const;

const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.trim()).filter(Boolean);

// old single-select links (?cat=…&cls=…) keep working
const LEGACY: Record<string, string> = { cat: "section", cls: "type" };

/** Reads filters from the URL; only keys of enabled filters are honoured. */
export function readFilters(sp: SearchParams, settings: FilterSetting[]) {
  const allowed = new Set(settings.map((s) => s.facet_key));
  const filters: Record<string, string[]> = {};
  for (const raw of Object.keys(sp).sort()) {
    const k = LEGACY[raw] ?? raw;
    if (RESERVED.has(k) || !allowed.has(k)) continue;
    const vals = [...new Set([...(filters[k] ?? []), ...list(sp[raw])])].slice(0, 50);
    if (vals.length) filters[k] = vals;
  }
  const page = Math.max(1, Math.min(1000, Number(list(sp.page)[0]) || 1));
  const col = list(sp.col)[0] ?? "";
  const sort = list(sp.sort)[0] ?? "";
  return {
    filters, q: list(sp.q)[0] ?? "", city: list(sp.city)[0] ?? "", page,
    col: /^[a-z0-9-]{2,60}$/.test(col) ? col : "",
    sort: (SORTS as readonly string[]).includes(sort) && sort !== "recommended" ? sort : "",
  };
}

/** Builds a URL for the same page with one change; filters stay in a stable order. */
export function hrefWith(base: string, state: { q?: string; city?: string; col?: string; sort?: string; filters: Record<string, string[]>; page?: number }) {
  const u = new URLSearchParams();
  if (state.col) u.set("col", state.col);
  if (state.sort) u.set("sort", state.sort);
  if (state.q) u.set("q", state.q);
  if (state.city) u.set("city", state.city);
  for (const [k, vals] of Object.entries(state.filters)) vals.forEach((v) => u.append(k, v));
  if (state.page && state.page > 1) u.set("page", String(state.page));
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

/** Enabled filters for a scope, with options that at least one product carries. */
export async function loadFilterSettings(supabase: Client, scope: "dorva" | "pharmacy") {
  const { data } = await supabase.from("catalog_filters")
    .select("facet_key, label, sort, searchable, show_counts, scope")
    .eq("enabled", true).in("scope", ["both", scope]).order("sort");
  return (data as FilterSetting[]) ?? [];
}

export async function loadFilterGroups(supabase: Client, settings: FilterSetting[], opts: {
  locale: Locale; scope: "dorva" | "pharmacy"; cityId: number | null; q: string;
  filters: Record<string, string[]>; pharmacyId?: string | null; collectionId?: string | null;
  valueLabel?: (key: string, value: string) => string | undefined;
}): Promise<FilterGroup[]> {
  const { data: rows } = await supabase.rpc("shop_filter_options", {
    p_city: opts.cityId, p_query: opts.q || null, p_filters: opts.filters,
    p_pharmacy: opts.pharmacyId ?? null, p_scope: opts.scope, p_collection: opts.collectionId ?? null,
  });
  const byKey = new Map<string, OptionRow[]>();
  for (const r of (rows as OptionRow[]) ?? []) {
    if (!byKey.has(r.facet_key)) byKey.set(r.facet_key, []);
    byKey.get(r.facet_key)!.push(r);
  }
  return settings.map((s) => {
    const selected = opts.filters[s.facet_key] ?? [];
    const options: FilterOption[] = (byKey.get(s.facet_key) ?? []).map((r) => ({
      value: r.value_code,
      label: opts.valueLabel?.(s.facet_key, r.value_code) ?? localized(r.name_fa, r.name_i18n, opts.locale),
      count: r.products,
    }));
    // a chosen value stays visible even when other filters leave it with no products
    for (const v of selected) if (!options.some((o) => o.value === v)) options.push({ value: v, label: opts.valueLabel?.(s.facet_key, v) ?? v, count: 0 });
    options.sort((a, b) => Number(selected.includes(b.value)) - Number(selected.includes(a.value)) || b.count - a.count || a.label.localeCompare(b.label, opts.locale));
    return {
      key: s.facet_key,
      label: s.label?.[opts.locale] || s.label?.fa || s.facet_key,
      searchable: s.searchable, showCounts: s.show_counts, options, selected,
    };
  }).filter((g) => g.options.length > 0);
}
