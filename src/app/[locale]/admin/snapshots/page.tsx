import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getRules } from "@/i18n/dictionaries/rules";
import { getSnapshotTexts } from "@/i18n/dictionaries/snapshots";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GROUPS = ["settings", "pages", "products", "stock"] as const;
type Snap = { id: number; name: string; note: string | null; groups: string[]; counts: Record<string, number>; auto: boolean; created_at: string; by: string | null };

const loc = (fd: FormData) => { const raw = String(fd.get("locale") ?? "fa"); return isLocale(raw) ? raw : "fa"; };
const back = (locale: string, r: string, extra = "") => {
  revalidatePath(`/${locale}/admin/snapshots`);
  revalidatePath("/[locale]", "layout");
  redirect(`/${locale}/admin/snapshots?r=${encodeURIComponent(r)}${extra}`);
};
const picked = (fd: FormData) => GROUPS.filter((g) => fd.get(`g_${g}`) === "on");

async function createSnap(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const name = String(fd.get("name") ?? "").trim();
  const groups = picked(fd);
  if (!name) back(locale, "name");
  if (!groups.length) back(locale, "groups");
  const { error } = await (await createClient()).rpc("config_snapshot_create", { p_name: name, p_groups: groups, p_note: String(fd.get("note") ?? "") || null });
  back(locale, error ? "error" : "created", error ? `&e=${encodeURIComponent(error.message.slice(0, 160))}` : "");
}
async function restoreSnap(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const groups = picked(fd);
  if (!groups.length) back(locale, "groups");
  const { data, error } = await (await createClient()).rpc("config_snapshot_restore", {
    p_id: Number(fd.get("id")), p_groups: groups, p_confirm: String(fd.get("confirm") ?? ""),
  });
  const res = data as { ok?: boolean; error?: string } | null;
  if (error) back(locale, "error", `&e=${encodeURIComponent(error.message.slice(0, 160))}`);
  back(locale, res?.ok ? "restored" : res?.error ?? "error");
}
async function deleteSnap(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { error } = await (await createClient()).rpc("config_snapshot_delete", { p_id: Number(fd.get("id")) });
  back(locale, error ? "error" : "deleted");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getSnapshotTexts(locale).tab, robots: { index: false } };
}

export default async function AdminSnapshots({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string; e?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/snapshots`);
  const S = getSnapshotTexts(locale);
  const sp = await searchParams;
  const { data, error } = await (await createClient()).rpc("config_snapshots");
  if (error) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const snaps = (data as Snap[] | null) ?? [];
  const okMsg = ["created", "restored", "deleted"].includes(sp.r ?? "");
  const when = (s: string) => new Date(s).toLocaleString(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const rowsIn = (s: Snap) => formatNumber(Object.values(s.counts ?? {}).reduce((a, b) => a + Number(b), 0), locale);

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="snapshots" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{S.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{S.intro}</p>
      {sp.r && (
        <p role="status" className={`rounded-xl p-3 text-sm ${okMsg ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>
          {S.results[sp.r] ?? sp.r}{sp.r === "error" && sp.e ? <span dir="ltr"> {sp.e}</span> : null}
        </p>
      )}

      <section className="card space-y-3">
        <h2 className="font-bold">{S.createTitle}</h2>
        <form action={createSnap} className="space-y-3">
          {hidden}
          <label className="block max-w-md"><span className="label">{S.name}</span>
            <input name="name" required maxLength={120} defaultValue={snaps.length ? "" : S.defaultName} placeholder={S.namePh} className="input" /></label>
          <fieldset className="space-y-1">
            {GROUPS.map((g) => (
              <label key={g} className="flex items-start gap-2 text-sm"><input type="checkbox" name={`g_${g}`} defaultChecked className="mt-1 h-4 w-4 accent-brand-600" /> {S.groups[g]}</label>
            ))}
          </fieldset>
          <label className="block max-w-md"><span className="label">{S.note}</span><input name="note" maxLength={500} className="input" /></label>
          <SubmitButton className="btn text-sm">{S.create}</SubmitButton>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">{S.listTitle}</h2>
        {snaps.length === 0 && <p className="text-sm text-muted">{S.empty}</p>}
        {snaps.map((s) => (
          <article key={s.id} className={`card space-y-3 ${s.auto ? "border-dashed" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-bold">{s.name}</h3>
              <span className="text-xs text-muted">{when(s.created_at)}{s.by ? ` · ${S.by} ${s.by}` : ""}</span>
            </div>
            <p className="flex flex-wrap gap-1 text-xs">
              {s.auto && <span className="chip bg-amber-50 text-amber-800">{S.auto}</span>}
              {s.groups.map((g) => <span key={g} className="chip">{S.groupShort[g] ?? g}</span>)}
              <span className="chip">{rowsIn(s)} {S.rows}</span>
            </p>
            {s.note && <p className="text-sm text-muted">{s.note}</p>}
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">{S.restoreTitle}</summary>
              <form action={restoreSnap} className="mt-3 space-y-3">
                {hidden}<input type="hidden" name="id" value={s.id} />
                <fieldset className="space-y-1">
                  <legend className="label">{S.restoreWhat}</legend>
                  {GROUPS.filter((g) => s.groups.includes(g)).map((g) => (
                    <label key={g} className="flex items-start gap-2 text-sm"><input type="checkbox" name={`g_${g}`} defaultChecked className="mt-1 h-4 w-4 accent-brand-600" /> {S.groups[g]}</label>
                  ))}
                </fieldset>
                <input name="confirm" required autoComplete="off" placeholder={S.confirmPh} className="input max-w-md" />
                <SubmitButton className="btn text-sm">{S.restore}</SubmitButton>
              </form>
              <form action={deleteSnap} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                {hidden}<input type="hidden" name="id" value={s.id} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" required /> {S.delConfirm}</label>
                <SubmitButton className="btn-ghost text-sm text-red-700">{S.del}</SubmitButton>
              </form>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}
