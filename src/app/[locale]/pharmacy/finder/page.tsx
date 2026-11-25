import Link from "next/link";
import { getFixTexts } from "@/i18n/dictionaries/fixes";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, localized, resolveLocale } from "@/i18n";
import { getFinderTexts } from "@/i18n/dictionaries/finder";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { confirmAllFinder, setFinderStock, suggestFinder } from "@/lib/finderActions";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  drug_id: string; product_id: string; name_fa: string; dispensing_class: string; have: boolean; fresh: boolean;
  confirmed_at: string | null; expires_at: string | null; calls_30d: number; reports_30d: number;
};
type Sug = { id: string; name_fa: string; status: string; review_note: string | null; created_at: string };
type Stats = { calls: number; reports: number; declared: number; demoted: number };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getFinderTexts(locale).phTitle, robots: { index: false } };
}

// Pharmacy panel: "I have it" for each shortage medicine, renewals, suggestions, own numbers.
export default async function PharmacyFinderPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string; r?: string; sq?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const F = getFinderTexts(locale);
  const sp = await searchParams;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/finder`);
  const supabase = await createClient();
  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phId = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!phId) redirect(`/${locale}/pharmacy/dashboard`);
  const sq = (sp.sq ?? "").trim().slice(0, 60);

  const [{ data: phData }, { data: listData, error }, { data: sugData }, { data: statsData }, { data: alertData }, { data: setData }, { data: found }] = await Promise.all([
    supabase.from("pharmacies").select("id, name_fa, name_i18n").eq("id", phId).maybeSingle(),
    supabase.rpc("finder_pharmacy_list", { p_pharmacy: phId }),
    supabase.rpc("finder_my_suggestions", { p_pharmacy: phId }),
    supabase.rpc("finder_stats", { p_pharmacy: phId, p_days: 30 }),
    supabase.rpc("finder_alerts_for", { p_pharmacy: phId }),
    supabase.from("settings").select("key, value").eq("scope", "platform").in("key", ["finder.stock_ttl_days", "finder.direct_suggestions"]),
    sq.length >= 2
      ? supabase.from("catalog_products").select("id, name_fa, dispensing_class").eq("is_active", true).ilike("name_fa", `%${sq.replace(/[%_,()]/g, " ")}%`).order("name_fa").limit(15)
      : Promise.resolve({ data: [] }),
  ]);
  const ph = phData as { id: string; name_fa: string; name_i18n: Record<string, string> } | null;
  if (!ph || error) return <div className="card max-w-xl"><p className="text-sm">{F.forbidden}</p></div>;
  const rows = (listData as Row[]) ?? [];
  const sugs = (sugData as Sug[]) ?? [];
  const st = statsData as Stats | null;
  const set = new Map(((setData as { key: string; value: unknown }[]) ?? []).map((x) => [x.key, x.value]));
  const ttl = Number(set.get("finder.stock_ttl_days") ?? 3);
  const direct = set.get("finder.direct_suggestions") === true;
  const listed = new Set(rows.map((r) => r.product_id));
  const n = (v: number) => formatNumber(v, locale);
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : locale === "ar" ? "ar" : "en-US",
    { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
  const base = `/${locale}/pharmacy/finder?ph=${ph.id}`;
  const r = sp.r;
  const msg = !r ? null : r === "saved" ? F.saved : r.startsWith("n") && /^n\d+$/.test(r) ? F.confirmedAll(n(Number(r.slice(1))))
    : F.suggestResult[r] ?? F.result[r] ?? F.result.unknown;
  const hidden = (back = base) => (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="back" value={back} /><input type="hidden" name="pharmacy_id" value={ph.id} /></>);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${ph.id}`} className="text-sm text-brand-700 hover:underline">{localized(ph.name_fa, ph.name_i18n, locale)}</Link>
      <h1 className="text-2xl font-extrabold">{F.phTitle}</h1>
      <p className="text-sm text-muted">{F.phIntro(n(ttl))}</p>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{msg}</p>}
      {st && st.demoted > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{F.demotedWarn}</p>}

      {st && (
        <dl className="grid grid-cols-3 gap-3">
          {[[F.st.declared, st.declared], [F.st.calls, st.calls], [F.st.reports, st.reports]].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl bg-gray-50 p-3"><dt className="text-xs text-muted">{k} · {F.last30}</dt><dd className="text-lg font-bold">{n(Number(v))}</dd></div>
          ))}
        </dl>
      )}

      {(() => {
        const alerts = (alertData as { drug_id: string; name_fa: string; scope: string; searches: number }[] | null) ?? [];
        if (!alerts.length) return null;
        const X = getFixTexts(locale);
        return (
          <section className="card space-y-3 border-amber-300 bg-amber-50/40">
            <h2 className="font-bold">{X.alertsTitle}</h2>
            <p className="text-xs text-muted">{X.alertsIntro}</p>
            <ul className="divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.drug_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span><b>{a.name_fa}</b> <span className={`chip ms-1 ${a.scope === "national" ? "bg-red-50 text-red-700" : ""}`}>{X.scope[a.scope]}</span>
                    <span className="ms-2 text-xs text-muted">{X.searches(n(a.searches))}</span></span>
                  <span className="flex gap-2">
                    <form action={setFinderStock}>{hidden()}<input type="hidden" name="drug_id" value={a.drug_id} /><input type="hidden" name="have" value="1" />
                      <SubmitButton className="btn py-1 text-xs">{X.have}</SubmitButton></form>
                    <form action={setFinderStock}>{hidden()}<input type="hidden" name="drug_id" value={a.drug_id} /><input type="hidden" name="have" value="0" />
                      <SubmitButton className="btn-ghost py-1 text-xs">{X.dontHave}</SubmitButton></form>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{F.listTitle}</h2>
          {rows.some((x) => x.have) && (
            <form action={confirmAllFinder}>{hidden()}<SubmitButton className="btn-ghost text-sm" pendingLabel="…">{F.confirmAll}</SubmitButton></form>
          )}
        </div>
        {rows.length === 0 ? <p className="text-sm text-muted">{F.listEmptyPh}</p> : (
          <ul className="divide-y divide-line">
            {rows.map((x) => (
              <li key={x.drug_id} id={`d-${x.drug_id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{x.name_fa}{x.dispensing_class === "rx" && <span className="chip ms-2">{t.dispensing.rx}</span>}</p>
                  <p className={`text-xs ${!x.have ? "text-muted" : x.fresh ? "text-brand-700" : "text-red-700"}`}>
                    {!x.have ? F.stateNone : x.fresh ? F.stateFresh(date.format(new Date(x.expires_at!))) : F.stateExpired}
                  </p>
                  {(x.calls_30d > 0 || x.reports_30d > 0) && (
                    <p className="text-xs text-muted">{F.calls(n(x.calls_30d))} · {F.reports(n(x.reports_30d))} · {F.last30}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <form action={setFinderStock}>
                    {hidden(`${base}#d-${x.drug_id}`)}<input type="hidden" name="drug_id" value={x.drug_id} /><input type="hidden" name="have" value="1" />
                    <SubmitButton className={x.have && x.fresh ? "btn-ghost text-sm" : "btn text-sm"} pendingLabel="…">{x.have ? F.reconfirm : F.have}</SubmitButton>
                  </form>
                  {x.have && (
                    <form action={setFinderStock}>
                      {hidden(`${base}#d-${x.drug_id}`)}<input type="hidden" name="drug_id" value={x.drug_id} /><input type="hidden" name="have" value="0" />
                      <SubmitButton className="btn-ghost text-sm" pendingLabel="…">{F.dontHave}</SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3" id="suggest">
        <h2 className="font-bold">{F.suggestTitle}</h2>
        <p className="text-sm text-muted">{direct ? F.suggestDirect : F.suggestHelp}</p>
        <form method="get" action={`/${locale}/pharmacy/finder#suggest`} className="flex gap-2">
          <input type="hidden" name="ph" value={ph.id} />
          <input type="search" name="sq" defaultValue={sq} placeholder={F.suggestSearch} className="input" />
          <button className="btn-ghost">{F.searchBtn}</button>
        </form>
        {((found as { id: string; name_fa: string; dispensing_class: string }[]) ?? []).map((p) => (
          <form key={p.id} action={suggestFinder} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
            {hidden(`${base}#suggest`)}<input type="hidden" name="product_id" value={p.id} />
            <span className="min-w-0 flex-1 text-sm">{p.name_fa}</span>
            {listed.has(p.id) ? <span className="chip">{F.inList}</span> : (
              <>
                <input name="note" maxLength={300} placeholder={F.suggestNote} className="input w-48" />
                <SubmitButton className="btn text-sm" pendingLabel="…">{F.suggestBtn}</SubmitButton>
              </>
            )}
          </form>
        ))}
        {sugs.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">{F.mySuggestions}</h3>
            <ul className="space-y-1 text-sm">
              {sugs.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-2">
                  <span>{s.name_fa}</span>
                  <span className={s.status === "approved" ? "text-brand-700" : s.status === "rejected" ? "text-red-700" : "text-muted"}>
                    {F.sStatus[s.status]}{s.review_note ? ` — ${s.review_note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
