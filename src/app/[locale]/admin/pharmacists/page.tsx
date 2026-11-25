import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { formatNumber, resolveLocale } from "@/i18n";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { getRules } from "@/i18n/dictionaries/rules";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import type { Bank } from "@/lib/bank";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getRound5Texts(locale).bank.title, robots: { index: false } };
}

// Dorva's database of partner pharmacists, built from technical officers' profiles.
export default async function PharmacistBank({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/pharmacists`);
  const T = getRound5Texts(locale);
  const B = T.bank;
  const O = T.officer;
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 80);
  const all = sp.all === "1";
  const { data, error } = await (await createClient()).rpc("pharmacist_bank", { p_q: q || null, p_all: all });
  if (error || !data) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const bank = data as Bank;
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(all ? { all: "1" } : {}) }).toString();

  return (
    <div className="space-y-5">
      <AdminTabs locale={locale} current="pharmacists" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{B.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{B.intro}</p>
      <form className="card flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder={B.search} className="input min-w-0 flex-1" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="all" value="1" defaultChecked={all} className="h-4 w-4 accent-brand-600" />{B.all}
        </label>
        <button type="submit" className="btn">{B.go}</button>
        <a href={`/api/admin/pharmacists-export${qs ? `?${qs}` : ""}`} className="btn-ghost text-sm">{B.csv}</a>
      </form>
      <p className="text-sm text-muted">{B.count.replace("{n}", formatNumber(bank.rows.length, locale)).replace("{t}", formatNumber(bank.total, locale)).replace("{c}", formatNumber(bank.consented, locale))}</p>
      {bank.rows.length === 0 ? <p className="card text-sm text-muted">{B.empty}</p> : (
        <div className="space-y-3">
          {bank.rows.map((r) => {
            const p = r.profile ?? {};
            const areas = Object.entries(p.areas ?? {}).filter(([, v]) => Number(v) > 0)
              .map(([k, v]) => `${O.areaOpts[k] ?? k}: ${formatNumber(Number(v), locale)}`);
            return (
              <details key={r.id} className="card">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1">
                  <b>{r.full_name}</b>
                  <span className="text-sm text-muted">{p.degree ? O.degrees[p.degree] ?? p.degree : "—"}{p.university ? ` · ${p.university}` : ""}</span>
                  {p.years_total && <span className="text-sm">{O.publicYears.replace("{n}", formatNumber(Number(p.years_total) || 0, locale))}</span>}
                  <span className="text-sm text-muted">{r.pharmacy.name_fa}{r.city ? ` · ${r.city}` : ""}</span>
                  <span className={`chip text-xs ${p.consent ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{B.consent}: {p.consent ? B.yes : B.no}</span>
                </summary>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  {r.council_no && <p><span className="text-muted">{getProfileTexts(locale).councilLabel}: </span><span dir="ltr">{r.council_no}</span></p>}
                  {p.specialty && <p><span className="text-muted">{O.specialty}: </span>{p.specialty}</p>}
                  {p.grad_year && <p><span className="text-muted">{O.gradYear}: </span>{p.grad_year}</p>}
                  {p.languages && <p><span className="text-muted">{O.languages}: </span>{p.languages}</p>}
                  {areas.length > 0 && <p className="sm:col-span-2"><span className="text-muted">{O.areas}: </span>{areas.join(" · ")}</p>}
                  {(p.expertise ?? []).length > 0 && <p className="sm:col-span-2"><span className="text-muted">{B.expertise}: </span>{(p.expertise ?? []).map((x) => O.expertiseOpts[x] ?? x).join("، ")}</p>}
                  {p.other_degrees && <p className="whitespace-pre-line sm:col-span-2"><span className="text-muted">{O.otherDegrees}: </span>{p.other_degrees}</p>}
                  {p.work_history && <p className="whitespace-pre-line sm:col-span-2"><span className="text-muted">{O.workHistory}: </span>{p.work_history}</p>}
                  {p.achievements && <p className="whitespace-pre-line sm:col-span-2"><span className="text-muted">{O.achievements}: </span>{p.achievements}</p>}
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    {r.resume && <a href={`/api/pharmacy/officer-resume?path=${encodeURIComponent(r.resume)}`} target="_blank" rel="noreferrer" className="btn-ghost text-xs">{O.resumeView} ↗</a>}
                    <Link href={`/${locale}/${r.pharmacy.slug}?tab=about`} className="btn-ghost text-xs">{B.pharmacy}: {r.pharmacy.name_fa} ↗</Link>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
