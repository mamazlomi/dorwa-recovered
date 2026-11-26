import type { MetadataRoute } from "next";
import { LOCALE_CODES } from "@/i18n/config";
import { anonClient, SITE_URL } from "@/lib/seo";

export const revalidate = 3600;

type SiteMapData = { products?: { id: string; at: string }[]; pharmacies?: { slug: string; at: string }[]; collections?: { slug: string; at: string }[] };

// Every public page in the three languages, each with its alternates. Empty while indexing is off.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = anonClient();
  if (!supabase) return [];
  const { data } = await supabase.rpc("seo_sitemap");
  const m = (data as SiteMapData | null) ?? {};
  if (!m.products && !m.pharmacies) return [];
  const entry = (path: string, at?: string, priority = 0.6, freq: "daily" | "weekly" | "monthly" = "weekly") =>
    LOCALE_CODES.map((l) => ({
      url: `${SITE_URL}/${l}${path}`,
      lastModified: at ? new Date(at) : new Date(),
      changeFrequency: freq,
      priority,
      alternates: { languages: Object.fromEntries(LOCALE_CODES.map((x) => [x, `${SITE_URL}/${x}${path}`])) },
    }));
  return [
    ...entry("", undefined, 1, "daily"),
    ...entry("/products", undefined, 0.9, "daily"),
    ...entry("/pharmacies", undefined, 0.8, "daily"),
    ...entry("/finder", undefined, 0.7, "daily"),
    ...entry("/consult", undefined, 0.6, "daily"),
    ...entry("/forum", undefined, 0.6, "daily"),
    ...entry("/magazine", undefined, 0.6, "weekly"),
    ...entry("/about", undefined, 0.4, "monthly"),
    ...(m.collections ?? []).flatMap((c) => entry(`/products?col=${encodeURIComponent(c.slug)}`, c.at, 0.7, "daily")),
    ...(m.pharmacies ?? []).flatMap((p) => entry(`/${p.slug}`, p.at, 0.8, "daily")),
    ...(m.products ?? []).flatMap((p) => entry(`/product/${p.id}`, p.at, 0.6, "weekly")),
  ].slice(0, 49000);
}
