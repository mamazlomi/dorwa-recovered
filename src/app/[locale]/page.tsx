import { jsonLd, pageMeta, SITE_URL } from "@/lib/seo";
import Link from "next/link";
import { CollectionRows } from "@/components/CollectionRows";
import { Icon } from "@/components/Icons";
import { NearMe } from "@/components/NearMe";
import { PageBlocks } from "@/components/PageBlocks";
import { QuickGrid } from "@/components/QuickGrid";
import { loadTheme } from "@/lib/theme";
import { AddedBar } from "@/components/QuickAdd";
import { SetupNotice } from "@/components/SetupNotice";
import { formatNumber, localized, resolveLocale } from "@/i18n";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { readAddress } from "@/lib/address";
import { loadFeatured } from "@/lib/collections";
import { isConfigured } from "@/lib/config";
import { asBlocks } from "@/lib/pageBlocks";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Named = { name_fa: string; name_i18n: Record<string, string> };
type City = Named & { id: number; slug: string };
type Row = Named & { pharmacy_id: string; slug: string; city_id: number; is_virtual: boolean; offers_count: number };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return pageMeta({ locale, path: "/" });
}

// Dorva home page: the layout built in the page builder (banners, tiles, rows),
// then "pharmacies near you". ?preview=1 shows the unpublished draft to editors.
export default async function Home({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ added?: string; preview?: string; city?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const L = getLookTexts(locale);
  const ct = getCollectionTexts(locale);
  const sp = await searchParams;
  const supabase = await createClient();
  const theme = await loadTheme();
  const [{ data: citiesData }, addr, { data: liveData }, editor] = await Promise.all([
    supabase.from("cities").select("id, slug, name_fa, name_i18n").order("id"),
    readAddress(),
    supabase.rpc("page_public", { p_pharmacy: null }),
    sp.preview === "1" ? supabase.rpc("page_editor", { p_pharmacy: null }) : Promise.resolve({ data: null }),
  ]);
  const cities = (citiesData as City[]) ?? [];
  const city = cities.find((c) => c.slug === (sp.city ?? addr?.city)) ?? cities.find((c) => c.slug === "tehran") ?? cities[0];
  const draft = (editor.data as { draft?: unknown } | null)?.draft;
  const blocks = asBlocks(draft ?? liveData);
  const keepCity = city ? `?city=${city.slug}` : "";

  const [{ data: phData }, featured] = await Promise.all([
    supabase.rpc("search_pharmacies", { p_city: city?.id ?? null, p_limit: 6 }),
    blocks.length ? Promise.resolve([]) : loadFeatured(supabase, null, city?.id ?? null),
  ]);
  const pharmacies = (phData as Row[]) ?? [];
  const cityLabel = city ? localized(city.name_fa, city.name_i18n, locale) : "";

  return (
    <div className="space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({
        "@context": "https://schema.org", "@graph": [
          { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: t.brand, url: SITE_URL, logo: `${SITE_URL}/brand/dorva-logo.png` },
          { "@type": "WebSite", "@id": `${SITE_URL}/#site`, url: `${SITE_URL}/${locale}`, name: t.brand, inLanguage: locale, publisher: { "@id": `${SITE_URL}/#org` },
            potentialAction: { "@type": "SearchAction", target: `${SITE_URL}/${locale}/products?q={search_term_string}`, "query-input": "required name=search_term_string" } },
        ] }) }} />
      {draft != null && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{L.home.previewNote}</p>}
      <AddedBar show={!!sp.added} locale={locale} text={ct.addedBar} cta={ct.goToCart} />
      <QuickGrid locale={locale} mode={theme.app.quickGrid} />

      {blocks.length > 0 ? (
        <PageBlocks blocks={blocks} locale={locale} supabase={supabase} pharmacyId={null} cityId={city?.id ?? null}
          base={`/${locale}/products`} back={`/${locale}`} productQuery={keepCity} />
      ) : (
        <CollectionRows groups={featured} locale={locale} seeAllBase={`/${locale}/products${keepCity}`} productQuery={keepCity} back={`/${locale}`} />
      )}

      <section className="grid gap-4 rounded-3xl border border-line bg-white p-5 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Icon name="map" className="h-7 w-7" /></span>
          <h2 className="text-xl font-extrabold">{L.home.nearTitle}</h2>
          <p className="text-sm leading-7 text-muted">{L.home.nearBody}</p>
          <NearMe locale={locale} labels={{ ...t.nearMe, denied: L.geo.deniedHelp, unavailable: L.geo.unavailable, km: t.common.km }} />
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="section-title">{city ? L.home.pharmaciesTitle(cityLabel) : L.home.pharmaciesAll}</h3>
            <Link href={`/${locale}/pharmacies${keepCity}`} className="text-sm font-medium text-brand-700 hover:underline">{L.home.seeAllPharmacies}</Link>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {pharmacies.map((p) => (
              <li key={p.pharmacy_id}>
                <Link href={`/${locale}/${p.slug}`} className="flex items-center justify-between gap-2 rounded-2xl border border-line px-4 py-3 transition hover:border-brand-500 hover:bg-brand-50">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{localized(p.name_fa, p.name_i18n, locale)}</span>
                    <span className="text-xs text-muted">{t.home.itemsInStock(formatNumber(p.offers_count, locale))}</span>
                  </span>
                  {p.is_virtual && <span className="chip shrink-0">{t.common.virtual}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
