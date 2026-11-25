import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { NearMe } from "@/components/NearMe";
import { SetupNotice } from "@/components/SetupNotice";
import { formatNumber, localized, resolveLocale } from "@/i18n";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { getRules } from "@/i18n/dictionaries/rules";
import { readAddress } from "@/lib/address";
import { isConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Named = { name_fa: string; name_i18n: Record<string, string> };
type City = Named & { id: number; slug: string };
type District = Named & { id: number; city_id: number };
type Insurer = Named & { code: string };
type Row = Named & {
  pharmacy_id: string; slug: string; city_id: number; district_id: number | null;
  address: string | null; is_virtual: boolean; offers_count: number;
};
type SP = { q?: string; city?: string; district?: string; insurer?: string };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return pageMeta({ locale, path: "/pharmacies", title: getLookTexts(locale).pharmaciesPage.title });
}

// Pharmacy directory: search by name, city, district and insurer, or "nearest to me".
export default async function Pharmacies({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const L = getLookTexts(locale);
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: citiesData }, { data: insurersData }, addr] = await Promise.all([
    supabase.from("cities").select("id, slug, name_fa, name_i18n").order("id"),
    supabase.from("insurers").select("code, name_fa, name_i18n").order("code"),
    readAddress(),
  ]);
  const cities = (citiesData as City[]) ?? [];
  const insurers = (insurersData as Insurer[]) ?? [];
  // "all" = every city; a name search spans every city unless one is chosen;
  // with nothing chosen, the city of the delivery address (else Tehran).
  const allCities = sp.city === "all" || (!sp.city && !!sp.q);
  const city = allCities ? undefined
    : cities.find((c) => c.slug === (sp.city ?? addr?.city)) ?? cities.find((c) => c.slug === "tehran") ?? cities[0];
  const r = getRules(locale);

  const { data: districtsData } = city
    ? await supabase.from("districts").select("id, city_id, name_fa, name_i18n").eq("city_id", city.id).order("id")
    : { data: [] };
  const districts = (districtsData as District[]) ?? [];
  const district = districts.find((d) => String(d.id) === sp.district);
  const { data } = await supabase.rpc("search_pharmacies", {
    p_query: sp.q || null, p_city: city?.id ?? null, p_district: district?.id ?? null, p_insurer: sp.insurer || null,
  });
  const rows = (data as Row[]) ?? [];
  const cityName = new Map(cities.map((c) => [c.id, localized(c.name_fa, c.name_i18n, locale)]));
  const districtName = new Map(districts.map((d) => [d.id, localized(d.name_fa, d.name_i18n, locale)]));
  const here = `/${locale}/pharmacies`;

  return (
    <div className="space-y-5">
      <section className="card bg-gradient-to-l from-brand-50 to-white">
        <h1 className="mb-1 text-2xl font-extrabold">{L.pharmaciesPage.title}</h1>
        <p className="mb-4 max-w-2xl text-sm text-muted">{L.pharmaciesPage.intro}</p>
        <NearMe locale={locale} labels={{ ...t.nearMe, denied: L.geo.deniedHelp, unavailable: L.geo.unavailable, km: t.common.km }} />
      </section>

      <FilterBar
        action={here}
        clearHref={`${here}?city=all`}
        values={{ q: sp.q, city: city?.slug ?? "all", district: district ? String(district.id) : undefined, insurer: sp.insurer }}
        applyLabel={t.filters.apply}
        clearLabel={t.filters.clear}
        fields={[
          { type: "text", name: "q", label: t.filters.search, placeholder: t.filters.search },
          { type: "select", name: "city", label: t.filters.city, resets: ["district"],
            options: [{ value: "all", label: r.allCities }, ...cities.map((c) => ({ value: c.slug, label: localized(c.name_fa, c.name_i18n, locale) }))] },
          { type: "select", name: "district", label: t.filters.district, emptyLabel: t.filters.allDistricts,
            options: districts.map((d) => ({ value: String(d.id), label: localized(d.name_fa, d.name_i18n, locale) })) },
          { type: "select", name: "insurer", label: t.filters.insurer, emptyLabel: t.filters.allInsurers,
            options: insurers.map((i) => ({ value: i.code, label: localized(i.name_fa, i.name_i18n, locale) })) },
        ]}
      />

      <section id="list">
        <h2 className="mb-3 text-lg font-bold">
          {city && !sp.q && !district && !sp.insurer ? t.home.activeIn(cityName.get(city.id) ?? "") : t.filters.results(formatNumber(rows.length, locale))}
        </h2>
        {rows.length === 0 ? (
          <div className="card space-y-3 text-center">
            <p className="text-muted">{sp.q || sp.district || sp.insurer ? t.filters.noResults : t.home.noneInCity}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {(sp.q || sp.district || sp.insurer) && city && (
                <Link href={`${here}?city=${city.slug}`} className="btn-ghost">{r.keepCityOnly}</Link>
              )}
              <Link href={`${here}?city=all`} className="btn">{r.allCitiesBtn}</Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => (
              <Link key={p.pharmacy_id} href={`/${locale}/${p.slug}`} className="card transition hover:border-brand-500 hover:shadow-md">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-bold">{localized(p.name_fa, p.name_i18n, locale)}</span>
                  {p.is_virtual && <span className="chip">{t.common.virtual}</span>}
                </div>
                <p className="mb-3 text-sm text-muted">
                  {cityName.get(p.city_id)}
                  {p.district_id && districtName.get(p.district_id) ? ` — ${districtName.get(p.district_id)}` : ""}
                </p>
                <p className="text-sm">{t.home.itemsInStock(formatNumber(p.offers_count, locale))}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
