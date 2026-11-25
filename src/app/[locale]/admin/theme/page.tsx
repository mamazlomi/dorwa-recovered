import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { resolveLocale } from "@/i18n";
import { getRules } from "@/i18n/dictionaries/rules";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { isConfigured } from "@/lib/config";
import { mediaUrl } from "@/lib/pageBlocks";
import { addSchedule, createTheme, deleteSchedule, reviewLook, themeAction } from "@/lib/themeActions";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type T = { id: string; name: string; is_default: boolean; preset: string | null; has_draft: boolean; is_live: boolean;
  updated_at: string; published_at: string | null; schedules: number };
type S = { id: string; theme_id: string; theme_name: string; starts_at: string; ends_at: string; note: string | null; state: string };
type Look = { accent?: string; logo?: string; cover?: string; coverTone?: string };
type Q = { pharmacy_id: string; slug: string; name_fa: string; status: string; draft: Look | null; published: Look | null;
  submitted_at: string | null; review_note: string | null };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getStudioTexts(locale).title, robots: { index: false } };
}

// Dorva: the store's themes, their schedule, and pharmacy page looks awaiting approval.
export default async function AdminTheme({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const S = getStudioTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/theme`);
  const supabase = await createClient();
  const [{ data: tData, error }, { data: sData }, { data: qData }] = await Promise.all([
    supabase.rpc("theme_list"), supabase.rpc("theme_schedule_list"), supabase.rpc("pharmacy_look_queue"),
  ]);
  if (error) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const themes = (tData as T[]) ?? [];
  const scheds = (sData as S[]) ?? [];
  const looks = (qData as Q[]) ?? [];
  const sp = await searchParams;
  const when = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : locale === "ar" ? "ar" : "en-US",
    { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <div className="space-y-8">
      <AdminTabs locale={locale} current="theme" labels={getRules(locale)} />
      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold">{S.title}</h1>
        <p className="max-w-3xl text-sm text-muted">{S.intro}</p>
      </div>
      {sp.r && <p role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{S.result[sp.r] ?? S.result[sp.r.split(":")[0]] ?? S.result.unknown}</p>}

      {/* ---------------- themes */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{S.themes}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((th) => (
            <li key={th.id} className="card flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">{th.name}</h3>
                {th.is_default && <span className="chip bg-brand-50 text-brand-700">{S.isDefault}</span>}
                {th.is_live && <span className="chip bg-emerald-50 text-emerald-700">● {S.isLive}</span>}
                {th.has_draft && <span className="chip bg-amber-50 text-amber-800">{S.hasDraft}</span>}
                {th.preset && <span className="chip">{S.preset}</span>}
              </div>
              {th.schedules > 0 && <p className="text-xs text-muted">{S.schedTitle}: {th.schedules}</p>}
              <div className="mt-auto flex flex-wrap gap-2">
                <Link href={`/${locale}/admin/theme/${th.id}`} className="btn text-sm">{S.edit}</Link>
                {th.has_draft && (
                  <form action={themeAction}>{hidden}<input type="hidden" name="id" value={th.id} />
                    <SubmitButton name="act" value="publish" className="btn-ghost text-sm">{S.publish}</SubmitButton></form>
                )}
                {!th.is_default && (
                  <form action={themeAction}>{hidden}<input type="hidden" name="id" value={th.id} />
                    <SubmitButton name="act" value="default" className="btn-ghost text-sm">{S.makeDefault}</SubmitButton></form>
                )}
                {!th.is_default && (
                  <form action={themeAction}>{hidden}<input type="hidden" name="id" value={th.id} />
                    <SubmitButton name="act" value="delete" className="btn-ghost text-sm text-red-700">{S.remove}</SubmitButton></form>
                )}
              </div>
            </li>
          ))}
        </ul>
        <form action={createTheme} className="card flex flex-wrap items-end gap-3">
          {hidden}
          <label className="flex-1 min-w-48"><span className="label">{S.newName}</span>
            <input name="name" required maxLength={60} className="input" /></label>
          <label className="min-w-48"><span className="label">{S.copyOf}</span>
            <select name="from" className="input" defaultValue={themes.find((x) => x.is_default)?.id ?? ""}>
              <option value="">{S.blank}</option>
              {themes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          <SubmitButton className="btn">{S.create}</SubmitButton>
        </form>
      </section>

      {/* ---------------- schedule */}
      <section id="schedule" className="space-y-3">
        <h2 className="text-lg font-bold">{S.schedTitle}</h2>
        <p className="text-sm text-muted">{S.schedIntro}</p>
        {scheds.length === 0 ? <p className="text-sm text-muted">{S.schedEmpty}</p> : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {scheds.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className={`chip ${s.state === "running" ? "bg-emerald-50 text-emerald-700" : s.state === "ended" ? "opacity-60" : ""}`}>{S.state[s.state] ?? s.state}</span>
                <b>{s.theme_name}</b>
                <span className="text-muted">{when.format(new Date(s.starts_at))} ← → {when.format(new Date(s.ends_at))}</span>
                {s.note && <span className="text-muted">· {s.note}</span>}
                <form action={deleteSchedule} className="ms-auto">{hidden}<input type="hidden" name="id" value={s.id} />
                  <SubmitButton className="btn-ghost text-xs text-red-700">{S.remove}</SubmitButton></form>
              </li>
            ))}
          </ul>
        )}
        <form action={addSchedule} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          {hidden}
          <label><span className="label">{S.schedTheme}</span>
            <select name="theme_id" required className="input">
              {themes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          <label><span className="label">{S.starts}</span><input type="datetime-local" name="starts" required className="input" dir="ltr" /></label>
          <label><span className="label">{S.ends}</span><input type="datetime-local" name="ends" required className="input" dir="ltr" /></label>
          <label><span className="label">{S.note}</span><input name="note" maxLength={120} className="input" /></label>
          <SubmitButton className="btn">{S.add}</SubmitButton>
        </form>
      </section>

      {/* ---------------- pharmacy looks */}
      <section id="looks" className="space-y-3">
        <h2 className="text-lg font-bold">{S.looksTitle}</h2>
        <p className="text-sm text-muted">{S.looksIntro}{" "}
          <Link href={`/${locale}/admin/settings#theme.pharmacy_enabled`} className="text-brand-700 hover:underline">{getRules(locale).groups.theme ?? "⚙"}</Link></p>
        {looks.length === 0 ? <p className="text-sm text-muted">{S.looksEmpty}</p> : (
          <ul className="space-y-3">
            {looks.map((l) => {
              const d = l.draft ?? {};
              return (
                <li key={l.pharmacy_id} className="card space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/${locale}/${l.slug}`} target="_blank" className="font-bold hover:underline">{l.name_fa} ↗</Link>
                    <span className={`chip ${l.status === "pending" ? "bg-amber-50 text-amber-800" : ""}`}>{S.lookStatus[l.status] ?? l.status}</span>
                    {l.submitted_at && <span className="text-xs text-muted">{when.format(new Date(l.submitted_at))}</span>}
                  </div>
                  <LookPreview look={d} name={l.name_fa} />
                  {l.review_note && <p className="text-xs text-muted">{S.note}: {l.review_note}</p>}
                  <form action={reviewLook} className="flex flex-wrap items-center gap-2">
                    {hidden}<input type="hidden" name="pharmacy_id" value={l.pharmacy_id} />
                    <input name="note" maxLength={500} placeholder={S.notePh} className="input min-w-64 flex-1 text-sm" />
                    {l.status === "pending" && <SubmitButton name="act" value="approve" className="btn text-sm">{S.approve}</SubmitButton>}
                    {l.status === "pending" && <SubmitButton name="act" value="reject" className="btn-ghost text-sm text-red-700">{S.reject}</SubmitButton>}
                    {l.published && <SubmitButton name="act" value="unpublish" className="btn-ghost text-sm">{S.unpublish}</SubmitButton>}
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

const TONE: Record<string, string> = {
  brand: "linear-gradient(120deg,var(--color-brand-700),var(--color-brand-400))",
  accent: "linear-gradient(120deg,var(--color-accent-700),var(--color-accent-600))",
  dark: "linear-gradient(120deg,#0f172a,#334155)", soft: "linear-gradient(120deg,var(--color-brand-50),var(--color-accent-50))",
};

function LookPreview({ look, name }: { look: Look; name: string }) {
  const bg = look.cover ? `center/cover no-repeat url(${mediaUrl(look.cover)})` : TONE[look.coverTone ?? "brand"] ?? TONE.brand;
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="h-24" style={{ background: bg }} />
      <div className="flex items-center gap-3 p-3">
        {look.logo
          ? <img src={mediaUrl(look.logo)} alt="" className="h-12 w-12 rounded-lg border border-line object-cover" />
          : <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-50 text-lg font-bold" style={{ color: look.accent }}>{name.slice(0, 1)}</span>}
        <b style={{ color: look.accent }}>{name}</b>
        {look.accent && <span className="ms-auto inline-block h-5 w-5 rounded-full border border-line" style={{ background: look.accent }} title={look.accent} />}
      </div>
    </div>
  );
}
