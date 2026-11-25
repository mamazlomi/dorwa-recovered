import { cache } from "react";
import type { Metadata } from "next";
import { createClient as createAnon } from "@supabase/supabase-js";
import { LOCALE_CODES, type Locale } from "@/i18n/config";

// Technical SEO: canonical/alternate links, robots, Open Graph, and the
// settings + per-page overrides Dorva edits in the admin panel (seo_meta()).

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://dorva.vercel.app")
).replace(/\/$/, "");

export type SeoInfo = {
  indexing: boolean; index_rx: boolean; suffix: string;
  description: Partial<Record<Locale, string>>; google: string | null; bing: string | null;
  page: { title: Partial<Record<Locale, string>>; description: Partial<Record<Locale, string>>; noindex: boolean; og_image: string | null } | null;
};

const EMPTY: SeoInfo = { indexing: false, index_rx: false, suffix: "", description: {}, google: null, bing: null, page: null };

/** A cookie-less client: safe in sitemap/robots and cacheable. */
export function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createAnon(url, key, { auth: { persistSession: false } }) : null;
}

/** Settings and the override for one path (without the language prefix), once per request. */
export const loadSeo = cache(async (path: string | null): Promise<SeoInfo> => {
  const supabase = anonClient();
  if (!supabase) return EMPTY;
  const { data, error } = await supabase.rpc("seo_meta", { p_path: path });
  if (error || !data) return EMPTY;
  return { ...EMPTY, ...(data as Partial<SeoInfo>) };
});

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…`;
};

/**
 * Metadata for a public page. `path` has no language prefix ("/", "/products",
 * "/drmazloomi"). Dorva's override (admin › SEO) wins over the page's own text.
 */
export async function pageMeta(opts: {
  locale: Locale; path: string; title?: string; description?: string; image?: string | null;
  noindex?: boolean; type?: "website" | "article";
}): Promise<Metadata> {
  const seo = await loadSeo(opts.path);
  const o = seo.page;
  const title = o?.title?.[opts.locale] || opts.title;
  const description = clip(o?.description?.[opts.locale] || opts.description || seo.description[opts.locale] || "", 160) || undefined;
  const index = seo.indexing && !opts.noindex && !o?.noindex;
  const url = `${SITE_URL}/${opts.locale}${opts.path === "/" ? "" : opts.path}`;
  const image = o?.og_image || opts.image || `${SITE_URL}/icons/icon-512.png`;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(LOCALE_CODES.map((l) => [l, `${SITE_URL}/${l}${opts.path === "/" ? "" : opts.path}`])),
        "x-default": `${SITE_URL}/fa${opts.path === "/" ? "" : opts.path}`,
      },
    },
    robots: index ? { index: true, follow: true } : { index: false, follow: !seo.indexing ? false : true },
    openGraph: {
      type: opts.type ?? "website", url, title, description, siteName: "Dorva",
      locale: opts.locale === "fa" ? "fa_IR" : opts.locale === "ar" ? "ar" : "en_US",
      images: [{ url: image }],
    },
    twitter: { card: opts.image || o?.og_image ? "summary_large_image" : "summary", title, description, images: [image] },
  };
}

/** A schema.org block for search engines. */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
