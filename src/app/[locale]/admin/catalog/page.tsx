import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getCatalogSyncTexts } from "@/i18n/dictionaries/catalogSync";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Run = { id: number; mode: string; started_at: string; finished_at: string | null; ok: boolean | null; pages: number; received: number;
  created: number; updated: number; unchanged: number; skipped: number; deactivated: number; error: string | null };
type Admin = {
  can_manage: boolean; has_key: boolean; key_hint: string | null; enabled: boolean; minutes: number; full_hours: number; base: string;
  state: { last_ok_at: string | null; last_full_at: string | null; last_error: string | null; running: boolean; pending: string | null; resuming: boolean };
  counts: { api_active: number; api_off: number; complete: number; incomplete: number; seed_active: number; seed_total: number };
  missing: { code: string; n: number }[];
  runs: Run[];
};

const loc = (fd: FormData) => { const raw = String(fd.get("locale") ?? "fa"); return isLocale(raw) ? raw : "fa"; };
const back = (locale: string, r: string) => {
  revalidatePath(`/${locale}/admin/catalog`);
  redirect(`/${locale}/admin/catalog?r=${encodeURIComponent(r)}`);
};

async function saveKey(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { data, error } = await (await createClient()).rpc("catalog_key_set", { p_key: String(fd.get("key") ?? "") });
  back(locale, error ? "unknown" : data === "ok" ? "saved" : String(data));
}
async function clearKey(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { error } = await (await createClient()).rpc("catalog_key_clear");
  back(locale, error ? "unknown" : "cleared");
}
async function runChanges(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { data, error } = await (await createClient()).rpc("catalog_sync_request", { p_mode: "incremental" });
  back(locale, error ? "unknown" : String(data));
}
async function runFull(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { data, error } = await (await createClient()).rpc("catalog_sync_request", { p_mode: "full" });
  back(locale, error ? "unknown" : String(data));
}
async function runOne(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { data, error } = await (await createClient()).rpc("catalog_sync_request", { p_mode: "one", p_id: String(fd.get("id") ?? "") });
  back(locale, error ? "unknown" : String(data));
}
async function seedOff(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { error } = await (await createClient()).rpc("catalog_seed_active", { p_active: false });
  back(locale, error ? "unknown" : "seed");
}
async function seedOn(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { error } = await (await createClient()).rpc("catalog_seed_active", { p_active: true });
  back(locale, error ? "unknown" : "seed");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getCatalogSyncTexts(locale).title, robots: { index: false } };
}

export default async function AdminCatalogSync({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/catalog`);
  const S = getCatalogSyncTexts(locale);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catalog_sync_admin");
  if (error || !data) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const a = data as Admin;
  const fmt = (n: number) => formatNumber(Number(n || 0), locale);
  const when = (s: string | null) => s ? new Date(s).toLocaleString(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";
  const gap = (c: string) => S.gap[c] ?? c;
  const okMsg = ["ok", "queued", "saved", "cleared", "seed"].includes(sp.r ?? "");
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="catalog" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{S.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{S.intro}</p>
      {sp.r && <p role="status" className={`rounded-xl p-3 text-sm ${okMsg ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>{S.results[sp.r] ?? sp.r}</p>}

      <section className="card space-y-3">
        <h2 className="font-bold">{S.status}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3 rounded-xl border border-line p-2"><dt>{S.enabled}</dt><dd className="font-semibold">{a.enabled ? S.on : S.off} <span className="font-normal text-muted">({S.every(fmt(a.minutes), fmt(a.full_hours))})</span></dd></div>
          <div className="flex justify-between gap-3 rounded-xl border border-line p-2"><dt>{S.lastOk}</dt><dd>{when(a.state.last_ok_at)}</dd></div>
          <div className="flex justify-between gap-3 rounded-xl border border-line p-2"><dt>{S.lastFull}</dt><dd>{when(a.state.last_full_at)}</dd></div>
          <div className="flex justify-between gap-3 rounded-xl border border-line p-2"><dt>{S.keyTitle}</dt><dd dir="ltr">{a.has_key ? a.key_hint : "—"}</dd></div>
        </dl>
        {(a.state.running || a.state.pending || a.state.resuming) && (
          <p className="text-sm text-brand-700">{a.state.running ? S.running : a.state.pending ? S.pending : ""} {a.state.resuming ? S.resuming : ""}</p>
        )}
        {a.state.last_error && <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{S.lastError}: <span dir="ltr">{a.state.last_error}</span></p>}
        {a.can_manage && (
          <div className="flex flex-wrap items-center gap-2">
            <form action={runChanges}>{hidden}<SubmitButton className="btn text-sm">{S.runIncremental}</SubmitButton></form>
            <form action={runFull}>{hidden}<SubmitButton className="btn-ghost text-sm">{S.runFull}</SubmitButton></form>
            <Link href={`/${locale}/admin/settings#catalog.sync_enabled`} className="btn-ghost text-sm">{S.settings}</Link>
          </div>
        )}
        <p className="text-xs text-muted">{S.fullHelp}</p>
      </section>

      {a.can_manage && (
        <section className="card space-y-3">
          <h2 className="font-bold">{S.keyTitle}</h2>
          <p className="text-sm text-muted">{S.keyHelp}</p>
          <p className={`text-sm font-semibold ${a.has_key ? "text-brand-700" : "text-amber-800"}`}>{a.has_key ? S.keySet : S.keyNone}</p>
          <form action={saveKey} className="flex flex-wrap items-center gap-2">
            {hidden}
            <input name="key" type="password" required autoComplete="off" spellCheck={false} dir="ltr"
              placeholder={S.keyPlaceholder} className="input min-w-0 flex-1 sm:max-w-md" />
            <SubmitButton className="btn text-sm">{S.keySave}</SubmitButton>
          </form>
          {a.has_key && <form action={clearKey}>{hidden}<SubmitButton className="btn-ghost text-sm text-red-700">{S.keyClear}</SubmitButton></form>}
        </section>
      )}

      {a.can_manage && (
        <section className="card space-y-3">
          <h2 className="font-bold">{S.oneTitle}</h2>
          <form action={runOne} className="flex flex-wrap items-center gap-2">
            {hidden}
            <input name="id" required dir="ltr" placeholder={S.onePlaceholder} className="input min-w-0 flex-1 sm:max-w-sm" />
            <SubmitButton className="btn-ghost text-sm">{S.oneRun}</SubmitButton>
          </form>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-bold">{S.counts}</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {([[S.apiActive, a.counts.api_active], [S.complete, a.counts.complete], [S.incomplete, a.counts.incomplete], [S.apiOff, a.counts.api_off]] as const).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-xl border border-line p-2"><span>{k}</span><b>{fmt(v)}</b></div>
          ))}
        </div>
        {a.missing.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{S.missingTitle}</h3>
            <p className="text-xs text-muted">{S.gapHelp}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Link href={`/${locale}/admin/prices?src=api&comp=no`} className="chip">{S.incomplete} · {fmt(a.counts.incomplete)}</Link>
              {a.missing.map((m) => (
                <Link key={m.code} href={`/${locale}/admin/prices?src=api&gap=${encodeURIComponent(m.code)}`} className="chip">{gap(m.code)} · {fmt(m.n)}</Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {a.can_manage && a.counts.seed_total > 0 && (
        <section className="card space-y-3">
          <h2 className="font-bold">{S.seedTitle}</h2>
          <p className="text-sm text-muted">{S.seedHelp(fmt(a.counts.seed_active), fmt(a.counts.seed_total))}</p>
          {a.counts.seed_active > 0 ? (
            <form action={seedOff} className="flex flex-wrap items-center gap-3">
              {hidden}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" required />{S.seedConfirm}</label>
              <SubmitButton className="btn-ghost text-sm text-red-700">{S.seedOff}</SubmitButton>
            </form>
          ) : (
            <form action={seedOn}>{hidden}<SubmitButton className="btn-ghost text-sm">{S.seedOn}</SubmitButton></form>
          )}
        </section>
      )}

      <section className="card space-y-2">
        <h2 className="font-bold">{S.runs}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-start text-xs text-muted">
              {(["when", "mode", "result", "received", "created", "updated", "unchanged", "skipped", "deactivated"] as const).map((k) => <th key={k} className="py-2 pe-3 text-start font-medium">{S.cols[k]}</th>)}
            </tr></thead>
            <tbody>
              {a.runs.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2 pe-3 whitespace-nowrap">{when(r.started_at)}</td>
                  <td className="py-2 pe-3">{S.mode[r.mode] ?? r.mode}</td>
                  <td className="py-2 pe-3">
                    {r.ok === true ? <span className="text-brand-700">{S.ok}</span> : r.ok === false ? <span className="text-red-700" title={r.error ?? ""}>{S.failed}</span> : <span className="text-muted">{S.open}</span>}
                    {r.error && <div className="max-w-xs truncate text-xs text-red-700" dir="ltr">{r.error}</div>}
                  </td>
                  {([r.received, r.created, r.updated, r.unchanged, r.skipped, r.deactivated]).map((n, i) => <td key={i} className="py-2 pe-3">{fmt(n)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
