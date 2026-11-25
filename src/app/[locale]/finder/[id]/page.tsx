import Link from "next/link";
import { notFound } from "next/navigation";
import { FinderCall, FinderView } from "@/components/FinderCall";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, localized, resolveLocale } from "@/i18n";
import { getFinderTexts } from "@/i18n/dictionaries/finder";
import { readAddress } from "@/lib/address";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { reportMissing } from "@/lib/finderActions";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type City = { id: number; slug: string; name_fa: string; name_i18n: Record<string, string> };
type Drug = { drug_id: string; name_fa: string; name_en: string | null; generic_name: string | null; dispensing_class: string };
type Hit = {
  pharmacy_id: string; slug: string; name_fa: string; name_i18n: Record<string, string>; phone: string | null; address: string | null;
  city_id: number; city_name: string | null; in_city: boolean; distance_km: number | null; confirmed_at: string; demoted: boolean;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getFinderTexts(locale).nav };
}

// One shortage medicine: the pharmacies that say they have it, nearest first.
export default async function FinderDrugPage({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ city?: string; r?: string; rep?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const F = getFinderTexts(locale);
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: drugData }, { data: citiesData }, addr, { user }] = await Promise.all([
    supabase.rpc("finder_drug", { p_drug: id }),
    supabase.from("cities").select("id, slug, name_fa, name_i18n").order("id"),
    readAddress(),
    getUser(),
  ]);
  const drug = ((drugData as Drug[]) ?? [])[0];
  if (!drug) notFound();
  const cities = (citiesData as City[]) ?? [];
  const city = cities.find((c) => c.slug === (sp.city ?? addr?.city ?? "tehran"));
  // the saved address gives real distances when it is in the chosen city
  const useAddr = addr && (!city || !addr.city || addr.city === city.slug);
  const { data } = await supabase.rpc("finder_pharmacies", {
    p_drug: id, p_city: city?.id ?? null, p_lat: useAddr ? addr!.lat : null, p_lng: useAddr ? addr!.lng : null,
  });
  const hits = (data as Hit[]) ?? [];
  const otherOnly = city && hits.length > 0 && hits.every((h) => !h.in_city);
  const n = (v: number) => formatNumber(v, locale);
  const when = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : locale === "ar" ? "ar" : "en-US",
    { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
  const self = `/${locale}/finder/${id}${city ? `?city=${city.slug}` : ""}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <FinderView drug={id} city={city?.id ?? null} />
      <Link href={`/${locale}/finder${city ? `?city=${city.slug}` : ""}`} className="text-sm text-brand-700 hover:underline">{F.back}</Link>
      <section className="card">
        <h1 className="text-2xl font-extrabold">{drug.name_fa}</h1>
        {(drug.generic_name || drug.name_en) && <p className="text-sm text-muted" dir="ltr">{drug.generic_name ?? drug.name_en}</p>}
        {drug.dispensing_class === "rx" && <p className="mt-2 text-sm"><span className="chip">{t.dispensing.rx}</span> {F.rxNote}</p>}
        <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="label">{F.city}</span>
            <select name="city" defaultValue={city?.slug ?? ""} className="input">
              <option value="">{F.allCities}</option>
              {cities.map((c) => <option key={c.slug} value={c.slug}>{localized(c.name_fa, c.name_i18n, locale)}</option>)}
            </select>
          </label>
          <button className="btn-ghost">{F.searchBtn}</button>
        </form>
        {!useAddr && <p className="mt-2 text-xs text-muted">{F.pickLocation}</p>}
      </section>

      {sp.r && <p role="status" className={`rounded-xl p-3 text-sm ${sp.r === "ok" ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-900"}`}>
        {F.reportResult[sp.r] ?? F.reportResult.unknown}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{F.resultsTitle}</h2>
        {hits.length === 0 ? <p className="card text-sm text-muted">{F.noPharmacy}</p> : (
          <>
            {otherOnly && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{F.otherCities}</p>}
            <ul className="space-y-3">
              {hits.map((h) => (
                <li key={h.pharmacy_id} id={`ph-${h.pharmacy_id}`} className="card space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/${locale}/${h.slug}`} className="font-bold hover:underline">{localized(h.name_fa, h.name_i18n, locale)}</Link>
                      <p className="text-sm text-muted">
                        {h.city_name}{h.distance_km != null && ` · ${F.distance(n(Number(h.distance_km)))}`}
                      </p>
                      {h.address && <p className="text-xs text-muted">{h.address}</p>}
                      <p className="text-xs text-muted">{F.confirmed(when.format(new Date(h.confirmed_at)))}</p>
                    </div>
                    {h.phone ? (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums" dir="ltr">{h.phone}</span>
                        <FinderCall phone={h.phone} drug={id} pharmacy={h.pharmacy_id} city={city?.id ?? null} label={F.call} />
                      </div>
                    ) : <span className="text-xs text-muted">{F.noPhone}</span>}
                  </div>
                  {h.demoted && <p className="text-xs text-amber-800">{F.lowTrust}</p>}
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs text-muted hover:text-ink">{F.report}</summary>
                    {user ? (
                      <form action={reportMissing} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="back" value={`${self}#ph-${h.pharmacy_id}`} />
                        <input type="hidden" name="drug_id" value={id} />
                        <input type="hidden" name="pharmacy_id" value={h.pharmacy_id} />
                        <input name="note" maxLength={300} placeholder={F.reportNote} className="input min-w-0 flex-1" />
                        <SubmitButton className="btn-ghost" pendingLabel="…">{F.reportSend}</SubmitButton>
                      </form>
                    ) : (
                      <Link href={`/${locale}/login?next=${encodeURIComponent(self)}`} className="mt-2 inline-block text-brand-700 hover:underline">{F.reportLogin}</Link>
                    )}
                  </details>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">{F.callNote}</p>
          </>
        )}
      </section>
    </div>
  );
}
