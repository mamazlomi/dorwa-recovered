import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { getFixTexts } from "@/i18n/dictionaries/fixes";
import { SetupNotice } from "@/components/SetupNotice";
import { formatNumber, localized, resolveLocale } from "@/i18n";
import { getFinderTexts } from "@/i18n/dictionaries/finder";
import { readAddress } from "@/lib/address";
import { isConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type City = { id: number; slug: string; name_fa: string; name_i18n: Record<string, string> };
type Drug = {
  drug_id: string; product_id: string; name_fa: string; name_en: string | null; generic_name: string | null;
  dispensing_class: string; in_city: number; total: number;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  const F = getFinderTexts(locale);
  return pageMeta({ locale, path: "/finder", title: F.nav, description: F.intro });
}

// Patient search, no sign-in: the shortage list and how many pharmacies have each medicine now.
export default async function FinderPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; city?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const F = getFinderTexts(locale);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const supabase = await createClient();
  const addr = await readAddress();

  const { data: citiesData } = await supabase.from("cities").select("id, slug, name_fa, name_i18n").order("id");
  const cities = (citiesData as City[]) ?? [];
  const citySlug = sp.city ?? addr?.city ?? "tehran";
  const city = cities.find((c) => c.slug === citySlug);

  const { data, error } = await supabase.rpc("finder_search", { p_query: q || null, p_city: city?.id ?? null });
  const drugs = (data as Drug[]) ?? [];
  if (q && !error) {
    await supabase.rpc("finder_log", { p_kind: "search", p_query: q, p_results: drugs.length, p_city: city?.id ?? null }).then(() => null, () => null);
  }
  const n = (v: number) => formatNumber(v, locale);
  const keep = city ? `?city=${city.slug}` : "";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="card bg-gradient-to-l from-brand-50 to-white">
        <h1 className="mb-2 text-2xl font-extrabold">{F.title}</h1>
        <p className="mb-4 text-sm text-muted">{F.intro}</p>
        <form method="get" className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <input type="search" name="q" defaultValue={q} placeholder={F.search} aria-label={F.search} className="input" />
          <select name="city" defaultValue={city?.slug ?? ""} aria-label={F.city} className="input">
            <option value="">{F.allCities}</option>
            {cities.map((c) => <option key={c.slug} value={c.slug}>{localized(c.name_fa, c.name_i18n, locale)}</option>)}
          </select>
          <button className="btn">{F.searchBtn}</button>
        </form>
      </section>

      {(
        <section className="space-y-3">
          <h2 className="text-lg font-bold">{F.listTitle}</h2>
          {drugs.length === 0 ? (
            <p className="card text-sm text-muted">{q ? F.noMatch : F.emptyList}</p>
          ) : (<>
            {q && drugs.every((d) => (d as { fuzzy?: boolean }).fuzzy) && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{getFixTexts(locale).didYouMean(q)}</p>
            )}
            <ul className="space-y-2">
              {drugs.map((d) => (
                <li key={d.drug_id}>
                  <Link href={`/${locale}/finder/${d.drug_id}${keep}`}
                    className="card flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-brand-500">
                    <span className="min-w-0">
                      <span className="block font-semibold">{d.name_fa}</span>
                      {(d.generic_name || d.name_en) && <span className="block text-xs text-muted" dir="ltr">{d.generic_name ?? d.name_en}</span>}
                      {d.dispensing_class === "rx" && <span className="chip mt-1">{t.dispensing.rx}</span>}
                    </span>
                    <span className="text-end text-sm">
                      {d.total === 0 ? <span className="text-muted">{F.none}</span> : (
                        <>
                          {city && <span className={`block font-semibold ${d.in_city > 0 ? "text-brand-700" : "text-muted"}`}>{F.inCity(n(d.in_city))}</span>}
                          <span className="block text-xs text-muted">{F.total(n(d.total))}</span>
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>)}
        </section>
      )}
    </div>
  );
}
