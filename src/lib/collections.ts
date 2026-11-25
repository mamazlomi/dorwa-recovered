import { localized, type Locale } from "@/i18n";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
type I18n = Record<string, string>;

export type CollectionRow = {
  id: string; pharmacy_id: string | null; slug: string; title: I18n; description: I18n;
  rules: Record<string, string[]>[]; include_ids: string[]; exclude_ids: string[];
  only_discounted: boolean; sort_mode: string; status: string; featured: boolean; sort: number;
  row_limit: number; source_id: string | null; updated_at: string; show_as_tab: boolean; default_tab: boolean;
  review_note?: string | null;
};
export const COLLECTION_FIELDS =
  "id, pharmacy_id, slug, title, description, rules, include_ids, exclude_ids, only_discounted, sort_mode, status, featured, sort, row_limit, source_id, updated_at, show_as_tab, default_tab, review_note";

export type FeaturedItem = {
  collection_id: string; slug: string; title: I18n; sort: number; product_id: string; name_fa: string;
  name_i18n: I18n; dispensing_class: string; category_path: string[]; image_url: string | null;
  min_price: number | null; max_price: number | null; list_price: number | null; max_discount: number | null;
  pharmacies: number; total: number;
};
export type FeaturedGroup = { id: string; slug: string; title: I18n; total: number; items: FeaturedItem[] };

export const titleOf = (t: I18n | null | undefined, locale: Locale) => localized(t?.fa ?? "", t ?? {}, locale) || t?.fa || "";

/** Featured rows for the Dorva home page (pharmacyId null) or one pharmacy page. */
export async function loadFeatured(supabase: Client, pharmacyId: string | null, cityId: number | null) {
  const { data } = await supabase.rpc("featured_collections", { p_pharmacy: pharmacyId, p_city: cityId });
  const groups: FeaturedGroup[] = [];
  for (const r of (data as FeaturedItem[]) ?? []) {
    let g = groups.find((x) => x.id === r.collection_id);
    if (!g) groups.push((g = { id: r.collection_id, slug: r.slug, title: r.title, total: r.total, items: [] }));
    g.items.push(r);
  }
  return groups;
}

/** A visible collection by slug: the pharmacy's own first, then Dorva's. */
export async function findCollection(supabase: Client, slug: string, pharmacyId: string | null) {
  if (!slug) return null;
  const q = supabase.from("collections").select(COLLECTION_FIELDS).eq("slug", slug);
  if (pharmacyId) {
    const { data } = await q.or(`pharmacy_id.eq.${pharmacyId},pharmacy_id.is.null`);
    const rows = (data as CollectionRow[]) ?? [];
    return rows.find((r) => r.pharmacy_id === pharmacyId) ?? rows.find((r) => !r.pharmacy_id) ?? null;
  }
  const { data } = await q.is("pharmacy_id", null).maybeSingle();
  return (data as CollectionRow | null) ?? null;
}

/** Normalises a rules value coming from a form (JSON) into rule groups. */
export function parseRules(raw: string): Record<string, string[]>[] | null {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return v
      .filter((g) => g && typeof g === "object" && !Array.isArray(g))
      .map((g) => Object.fromEntries(
        Object.entries(g as Record<string, unknown>)
          .filter(([k, vals]) => /^[a-z_]+$/.test(k) && Array.isArray(vals))
          .map(([k, vals]) => [k, [...new Set((vals as unknown[]).map(String).filter(Boolean))].slice(0, 200)])
          .filter(([, vals]) => (vals as string[]).length > 0)))
      .filter((g) => Object.keys(g).length > 0)
      .slice(0, 20);
  } catch {
    return null;
  }
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
