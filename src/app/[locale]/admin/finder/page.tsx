import Link from "next/link";
import { getFixTexts } from "@/i18n/dictionaries/fixes";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, resolveLocale } from "@/i18n";
import { getFinderTexts } from "@/i18n/dictionaries/finder";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { adminFinderDecide, adminFinderSet } from "@/lib/finderActions";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  drug_id: string; product_id: string; name_fa: string; dispensing_class: string; status: string; origin: string;
  note: string | null; pharmacies_now: number; searches_30d: number; calls_30d: number; reports_30d: number;
};
type Sug = { id: string; product_id: string; name_fa: string; pharmacy_name: string; pharmacy_slug: string; note: string | null; same_count: number };
type Stats = Record<string, unknown> & {
  top_drugs: { name: string; views: number; calls: number }[]; unmet: { q: string; n: number }[];
  by_pharmacy: { name: string; calls: number; reports: number; demoted: boolean }[];
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getFinderTexts(locale).adminTitle, robots: { index: false } };
}

// Dorva: build the shortage list, decide pharmacy suggestions, watch the numbers.
export default async function AdminFinderPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const F = getFinderTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/finder`);
  const supabase = await createClient();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const [{ data: listData, error }, { data: sugData }, { data: statsData }, { data: demandData }, { data: found }] = await Promise.all([
    supabase.rpc("finder_admin_list"),
    supabase.rpc("finder_admin_suggestions"),
    supabase.rpc("finder_stats", { p_pharmacy: null, p_days: 30 }),
    supabase.rpc("finder_demand", { p_days: 30 }),
    q.length >= 2
      ? supabase.from("catalog_products").select("id, name_fa, generic_name, dispensing_class").eq("is_active", true)
          .or(`name_fa.ilike.%${q.replace(/[%_,()]/g, " ")}%,generic_name.ilike.%${q.replace(/[%_,()]/g, " ")}%`).order("name_fa").limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  if (error) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const rows = (listData as Row[]) ?? [];
  const sugs = (sugData as Sug[]) ?? [];
  const st = statsData as Stats | null;
  const status = new Map(rows.map((r) => [r.product_id, r.status]));
  const n = (v: unknown) => formatNumber(Number(v ?? 0), locale);
  const base = `/${locale}/admin/finder${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const hidden = (back = base) => (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="back" value={back} /></>);

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="finder" labels={getRules(locale)} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{F.adminTitle}</h1>
        <div className="flex gap-3 text-sm">
          <Link href={`/${locale}/finder`} className="text-brand-700 hover:underline">{F.nav} ↗</Link>
          <Link href={`/${locale}/admin/settings`} className="text-brand-700 hover:underline">{F.settingsLink}</Link>
        </div>
      </div>
      <p className="text-sm text-muted">{F.adminIntro}</p>
      {sp.r && <p role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{F.result[sp.r] ?? F.result.unknown}</p>}

      {st && (
        <section className="space-y-3">
          <h2 className="font-bold">{F.statsTitle}</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["searches", "views", "calls", "reports", "listed", "declared", "pending_suggestions", "demoted"].map((k) => (
              <div key={k} className="rounded-xl bg-gray-50 p-3"><dt className="text-xs text-muted">{F.st[k]}</dt><dd className="text-lg font-bold">{n(st[k])}</dd></div>
            ))}
          </dl>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">{F.topDrugs}</h3>
              {st.top_drugs.length === 0 ? <p className="text-xs text-muted">—</p> : (
                <ul className="space-y-1 text-sm">{st.top_drugs.map((d) => <li key={d.name} className="flex justify-between gap-2"><span>{d.name}</span><span className="text-muted">{n(d.views)} · {n(d.calls)}</span></li>)}</ul>
              )}
            </div>
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">{F.unmet}</h3>
              {st.unmet.length === 0 ? <p className="text-xs text-muted">—</p> : (
                <ul className="space-y-1 text-sm">{st.unmet.map((d) => <li key={d.q} className="flex justify-between gap-2"><span>{d.q}</span><span className="text-muted">{n(d.n)}</span></li>)}</ul>
              )}
            </div>
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">{F.byPharmacy}</h3>
              {st.by_pharmacy.length === 0 ? <p className="text-xs text-muted">—</p> : (
                <ul className="space-y-1 text-sm">{st.by_pharmacy.map((d) => (
                  <li key={d.name} className="flex justify-between gap-2">
                    <span>{d.name}{d.demoted && <span className="ms-1 text-xs text-amber-800">({F.demoted})</span>}</span>
                    <span className="text-muted">{F.calls(n(d.calls))} · {F.reports(n(d.reports))}</span>
                  </li>))}</ul>
              )}
            </div>
          </div>
        </section>
      )}

      {(() => {
        const X = getFixTexts(locale);
        const rows = (demandData as { product_id: string; name_fa: string; city_name: string | null; searches: number; spellings: string[];
          listed: boolean; scope: string | null; cities: number }[] | null) ?? [];
        return (
          <section className="card space-y-3" id="demand">
            <h2 className="font-bold">{X.demandTitle}</h2>
            <p className="text-xs text-muted">{X.demandIntro}</p>
            {rows.length === 0 ? <p className="text-sm text-muted">{X.noDemand}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-start text-xs text-muted">
                    <th className="py-1 text-start">{X.colProduct}</th><th className="text-start">{X.colCity}</th><th className="text-start">{X.colSearches}</th>
                    <th className="text-start">{X.colSpellings}</th><th className="text-start">{X.colStatus}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2 font-medium">{r.name_fa}</td>
                        <td>{r.city_name ?? "—"} {r.cities > 1 && <span className="text-xs text-muted">({X.cities(n(r.cities))})</span>}</td>
                        <td>{n(r.searches)}</td>
                        <td className="text-xs text-muted">{r.spellings.join("، ")}</td>
                        <td>{r.listed ? <span className="chip bg-brand-50 text-brand-700">{X.listed}{r.scope ? ` · ${X.scope[r.scope]}` : ""}</span> : <span className="chip">{X.notListed}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })()}

      <section className="card space-y-3">
        <h2 className="font-bold">{F.queueTitle}</h2>
        {sugs.length === 0 ? <p className="text-sm text-muted">{F.queueEmpty}</p> : sugs.map((s) => (
          <div key={s.id} className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-semibold">{s.name_fa}</span>
              <span className="text-muted">{s.pharmacy_name}{s.same_count > 1 && ` · ${F.sameCount(n(s.same_count))}`}</span>
            </div>
            {s.note && <p className="text-sm">{s.note}</p>}
            <div className="flex flex-wrap gap-2">
              <form action={adminFinderDecide} className="flex flex-wrap gap-2">
                {hidden()}<input type="hidden" name="suggestion_id" value={s.id} /><input type="hidden" name="approve" value="1" />
                <SubmitButton className="btn text-sm" pendingLabel="…">{F.approve}</SubmitButton>
              </form>
              <form action={adminFinderDecide} className="flex flex-wrap gap-2">
                {hidden()}<input type="hidden" name="suggestion_id" value={s.id} /><input type="hidden" name="approve" value="0" />
                <input name="note" maxLength={300} placeholder={F.reviewNote} className="input w-56" />
                <SubmitButton className="btn-ghost text-sm" pendingLabel="…">{F.reject}</SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </section>

      <section className="card space-y-3" id="add">
        <h2 className="font-bold">{F.addTitle}</h2>
        <form method="get" action={`/${locale}/admin/finder#add`} className="flex gap-2">
          <input type="search" name="q" defaultValue={q} placeholder={F.addSearch} className="input" />
          <button className="btn-ghost">{F.searchBtn}</button>
        </form>
        {((found as { id: string; name_fa: string; generic_name: string | null; dispensing_class: string }[]) ?? []).map((p) => (
          <form key={p.id} action={adminFinderSet} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
            {hidden(`${base}#add`)}<input type="hidden" name="product_id" value={p.id} /><input type="hidden" name="act" value="add" />
            <span className="min-w-0 flex-1 text-sm">{p.name_fa}{p.generic_name && <span className="ms-2 text-xs text-muted" dir="ltr">{p.generic_name}</span>}
              <span className="ms-2 text-xs text-muted">{t.dispensing[p.dispensing_class]}</span></span>
            {status.get(p.id) === "active" ? <span className="chip">{F.inList}</span> : (
              <SubmitButton className="btn text-sm" pendingLabel="…">{F.add}</SubmitButton>
            )}
          </form>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold">{F.listTitle}</h2>
        {rows.length === 0 ? <p className="text-sm text-muted">{F.emptyList}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-muted"><tr className="border-b border-line text-start">
                <th className="py-2 text-start">{F.listCol.drug}</th><th className="text-start">{F.listCol.now}</th>
                <th className="text-start">{F.listCol.views}</th><th className="text-start">{F.listCol.calls}</th>
                <th className="text-start">{F.listCol.reports}</th><th className="text-start">{F.listCol.status}</th><th />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.drug_id} className={`border-b border-line last:border-0 ${r.status === "off" ? "text-muted" : ""}`}>
                    <td className="py-2">{r.name_fa}{r.origin === "suggestion" && <span className="ms-2 text-xs text-muted">({F.fromSuggestion})</span>}</td>
                    <td>{n(r.pharmacies_now)}</td><td>{n(r.searches_30d)}</td><td>{n(r.calls_30d)}</td>
                    <td className={r.reports_30d > 0 ? "text-amber-800" : ""}>{n(r.reports_30d)}</td>
                    <td>{r.status === "active" ? F.on : F.offState}</td>
                    <td>
                      <form action={adminFinderSet}>
                        {hidden()}<input type="hidden" name="product_id" value={r.product_id} /><input type="hidden" name="act" value={r.status === "active" ? "off" : "on"} />
                        <SubmitButton className="btn-ghost px-2 py-1 text-xs" pendingLabel="…">{r.status === "active" ? F.turnOff : F.turnOn}</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
