import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getRules } from "@/i18n/dictionaries/rules";
import { getSeoTexts } from "@/i18n/dictionaries/seo";
import { isConfigured } from "@/lib/config";
import { loadSeo } from "@/lib/seo";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type L3 = { fa?: string; en?: string; ar?: string };
type PageRow = { path: string; title: L3; description: L3; noindex: boolean; og_image: string | null };
type RedirectRow = { from_path: string; to_path: string; permanent: boolean; active: boolean; note: string | null };
type Admin = {
  pages: PageRow[]; redirects: RedirectRow[];
  report: Record<string, number> & { samples: { no_image: { id: string; name: string }[]; ph_no_about: { slug: string; name: string }[] } };
};

const back = (fd: FormData) => { const raw = String(fd.get("locale") ?? "fa"); return isLocale(raw) ? raw : "fa"; };
const done = (locale: string, r: string, anchor: string) => {
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin/seo?r=${encodeURIComponent(r)}#${anchor}`);
};
const res = (x: { data: unknown; error: { code?: string } | null }) => (x.error ? (x.error.code === "42501" ? "forbidden" : "unknown") : String(x.data));
const tri = (fd: FormData, k: string): L3 => {
  const o: L3 = {};
  for (const l of ["fa", "en", "ar"] as const) { const v = String(fd.get(`${k}_${l}`) ?? "").trim(); if (v) o[l] = v.slice(0, 300); }
  return o;
};

async function savePage(fd: FormData) {
  "use server";
  const locale = back(fd);
  const supabase = await createClient();
  const r = await supabase.rpc("seo_page_save", {
    p_path: String(fd.get("path") ?? ""), p_title: tri(fd, "t"), p_description: tri(fd, "d"),
    p_noindex: fd.get("noindex") === "on", p_og_image: String(fd.get("og") ?? ""),
  });
  done(locale, res(r), "pages");
}
async function deletePage(fd: FormData) {
  "use server";
  const locale = back(fd);
  const r = await (await createClient()).rpc("seo_page_delete", { p_path: String(fd.get("path") ?? "") });
  done(locale, res(r), "pages");
}
async function saveRedirect(fd: FormData) {
  "use server";
  const locale = back(fd);
  const r = await (await createClient()).rpc("seo_redirect_save", {
    p_from: String(fd.get("from") ?? "").trim(), p_to: String(fd.get("to") ?? "").trim(),
    p_permanent: fd.get("permanent") === "on", p_active: fd.get("active") === "on", p_note: String(fd.get("note") ?? ""),
  });
  done(locale, res(r), "redirects");
}
async function deleteRedirect(fd: FormData) {
  "use server";
  const locale = back(fd);
  const r = await (await createClient()).rpc("seo_redirect_delete", { p_from: String(fd.get("from") ?? "") });
  done(locale, res(r), "redirects");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getSeoTexts(locale).title, robots: { index: false } };
}

export default async function AdminSeo({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/seo`);
  const S = getSeoTexts(locale);
  const sp = await searchParams;
  const [{ data, error }, seo] = await Promise.all([(await createClient()).rpc("seo_admin"), loadSeo(null)]);
  if (error || !data) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const a = data as Admin;
  const fmt = (n: number) => formatNumber(Number(n || 0), locale);
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const pageForm = (p: PageRow | null) => (
    <form key={p?.path ?? "new"} action={savePage} className="space-y-2 rounded-xl border border-line p-3">
      {hidden}
      <div className="flex flex-wrap items-center gap-2">
        {p ? <><input type="hidden" name="path" value={p.path} /><code className="text-sm font-bold" dir="ltr">{p.path}</code></>
          : <input name="path" required dir="ltr" placeholder="/products" className="input max-w-xs py-1 text-sm" aria-label={S.path} />}
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="noindex" defaultChecked={p?.noindex} className="accent-brand-600" />{S.noindex}</label>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {(["fa", "en", "ar"] as const).map((l) => (
          <div key={l} className="space-y-1">
            <input name={`t_${l}`} defaultValue={p?.title?.[l] ?? ""} maxLength={70} placeholder={l === "fa" ? S.titleFa : l === "en" ? S.titleEn : S.titleAr}
              dir={l === "en" ? "ltr" : "rtl"} className="input py-1 text-sm" />
            <textarea name={`d_${l}`} defaultValue={p?.description?.[l] ?? ""} maxLength={200} rows={2}
              placeholder={l === "fa" ? S.descFa : l === "en" ? S.descEn : S.descAr} dir={l === "en" ? "ltr" : "rtl"} className="input py-1 text-xs" />
          </div>
        ))}
      </div>
      <input name="og" dir="ltr" defaultValue={p?.og_image ?? ""} placeholder={S.ogImage} className="input py-1 text-xs" />
      <div className="flex gap-2">
        <SubmitButton className={p ? "btn-ghost py-1 text-xs" : "btn py-1 text-xs"}>{p ? S.save : S.add}</SubmitButton>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="seo" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{S.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{S.intro}</p>
      {sp.r && <p role="status" className={`rounded-xl p-3 text-sm ${sp.r === "ok" ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>{S.results[sp.r] ?? sp.r}</p>}
      <div className={`rounded-xl p-3 text-sm ${seo.indexing ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
        <p>{seo.indexing ? S.on : S.off}</p>
        <p className="mt-2 flex flex-wrap gap-3">
          <Link href={`/${locale}/admin/settings#seo.indexing`} className="font-semibold underline">{S.settings}</Link>
          <span>{S.links} <a href="/robots.txt" target="_blank" rel="noreferrer" className="underline" dir="ltr">robots.txt</a> · <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="underline" dir="ltr">sitemap.xml</a></span>
        </p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-bold">{S.report}</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.keys(S.rep).map((k) => (
            <div key={k} className={`flex items-center justify-between rounded-xl border p-2 text-sm ${["no_image", "no_en", "ph_no_about", "ph_short_about", "col_no_desc"].includes(k) && Number(a.report[k]) > 0 ? "border-amber-300" : "border-line"}`}>
              <span>{S.rep[k]}</span><b>{fmt(a.report[k])}</b>
            </div>
          ))}
        </div>
        {a.report.samples.no_image.length > 0 && (
          <details className="text-sm"><summary className="cursor-pointer">{S.samplesImage}</summary>
            <ul className="mt-2 list-inside list-disc">{a.report.samples.no_image.map((x) => <li key={x.id}><Link href={`/${locale}/product/${x.id}`} className="text-brand-700 hover:underline">{x.name}</Link></li>)}</ul></details>
        )}
        {a.report.samples.ph_no_about.length > 0 && (
          <details className="text-sm"><summary className="cursor-pointer">{S.samplesAbout}</summary>
            <ul className="mt-2 list-inside list-disc">{a.report.samples.ph_no_about.map((x) => <li key={x.slug}><Link href={`/${locale}/${x.slug}`} className="text-brand-700 hover:underline">{x.name}</Link></li>)}</ul></details>
        )}
      </section>

      <section id="pages" className="card space-y-3">
        <h2 className="font-bold">{S.pages}</h2>
        <p className="text-xs text-muted">{S.pagesHelp}</p>
        {a.pages.map((p) => (
          <div key={p.path} className="space-y-1">
            {pageForm(p)}
            <form action={deletePage}>{hidden}<input type="hidden" name="path" value={p.path} />
              <button type="submit" className="text-xs text-red-700">{S.del} <span dir="ltr">{p.path}</span></button></form>
          </div>
        ))}
        {pageForm(null)}
      </section>

      <section id="redirects" className="card space-y-3">
        <h2 className="font-bold">{S.redirects}</h2>
        <p className="text-xs text-muted">{S.redirectsHelp}</p>
        {[...a.redirects, null].map((r) => (
          <div key={r?.from_path ?? "new"} className="flex flex-wrap items-center gap-2">
            <form action={saveRedirect} className="flex flex-1 flex-wrap items-center gap-2">
              {hidden}
              {r ? <><input type="hidden" name="from" value={r.from_path} /><code className="text-xs" dir="ltr">{r.from_path}</code></>
                : <input name="from" required dir="ltr" placeholder={`${S.from}: /old-page`} className="input max-w-56 py-1 text-xs" />}
              <span aria-hidden>←</span>
              <input name="to" required dir="ltr" defaultValue={r?.to_path ?? ""} placeholder={`${S.to}: /fa/products`} className="input max-w-64 py-1 text-xs" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="permanent" defaultChecked={r ? r.permanent : true} className="accent-brand-600" />{S.permanent}</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={r ? r.active : true} className="accent-brand-600" />{S.active}</label>
              <input name="note" defaultValue={r?.note ?? ""} maxLength={200} placeholder={S.note} className="input max-w-40 py-1 text-xs" />
              <SubmitButton className={r ? "btn-ghost py-1 text-xs" : "btn py-1 text-xs"}>{r ? S.save : S.add}</SubmitButton>
            </form>
            {r && <form action={deleteRedirect}>{hidden}<input type="hidden" name="from" value={r.from_path} /><button type="submit" className="text-xs text-red-700">{S.del}</button></form>}
          </div>
        ))}
      </section>
    </div>
  );
}
