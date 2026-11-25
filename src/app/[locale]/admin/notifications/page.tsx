import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getNotifyTexts } from "@/i18n/dictionaries/notify";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ev = { code: string; audience: string; permission: string | null; label: Record<string, string>; sms: boolean; alarm: boolean; active: boolean };
type Admin = {
  events: Ev[];
  stats: { subscriptions: number; users_with_mobile: number; last_day: number; sms_sent: number; sms_failed: number; push_sent: number; queued: number; keys: boolean };
  log: { id: number; event: string; title: string; at: string; push: string; sms: string; read: boolean }[];
};

const loc = (fd: FormData) => { const raw = String(fd.get("locale") ?? "fa"); return isLocale(raw) ? raw : "fa"; };

async function saveEvent(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { data, error } = await (await createClient()).rpc("notify_event_save", {
    p_code: String(fd.get("code") ?? ""), p_sms: fd.get("sms") === "on", p_alarm: fd.get("alarm") === "on", p_active: fd.get("active") === "on",
  });
  revalidatePath(`/${locale}/admin/notifications`);
  redirect(`/${locale}/admin/notifications?r=${error ? "unknown" : String(data)}`);
}
async function sendTest(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { error } = await (await createClient()).rpc("notify_test");
  redirect(`/${locale}/admin/notifications?r=${error ? "unknown" : "test"}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getNotifyTexts(locale).admin.title, robots: { index: false } };
}

export default async function AdminNotifications({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/notifications`);
  const A = getNotifyTexts(locale).admin;
  const sp = await searchParams;
  const { data, error } = await (await createClient()).rpc("notify_admin");
  if (error || !data) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const a = data as Admin;
  const fmt = (n: number) => formatNumber(Number(n || 0), locale);
  const when = (s: string) => new Date(s).toLocaleString(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  const groups = ["pharmacy", "platform", "customer"] as const;

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="notifications" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{A.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{A.intro}</p>
      {sp.r && <p role="status" className={`rounded-xl p-3 text-sm ${sp.r === "ok" || sp.r === "test" ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>
        {sp.r === "test" ? A.testOk : sp.r === "ok" ? A.saved : sp.r}</p>}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{A.stats}</h2>
          <div className="flex flex-wrap gap-2">
            <form action={sendTest}><input type="hidden" name="locale" value={locale} /><SubmitButton className="btn text-sm">{A.test}</SubmitButton></form>
            <Link href={`/${locale}/admin/settings#notify.sms_enabled`} className="btn-ghost text-sm">{A.settings}</Link>
          </div>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {([["subs", a.stats.subscriptions], ["mobiles", a.stats.users_with_mobile], ["lastDay", a.stats.last_day], ["queued", a.stats.queued],
            ["pushSent", a.stats.push_sent], ["smsSent", a.stats.sms_sent], ["smsFailed", a.stats.sms_failed]] as const).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-xl border border-line p-2"><span>{A[k]}</span><b>{fmt(v)}</b></div>
          ))}
          <div className="flex items-center justify-between rounded-xl border border-line p-2"><span>{A.keys}</span><b className="text-xs">{a.stats.keys ? A.yes : A.no}</b></div>
        </div>
        <details className="rounded-xl bg-paper p-3 text-sm" open={a.stats.sms_failed > 0}>
          <summary className="cursor-pointer font-semibold">{A.setup}</summary>
          <p className="mt-2 leading-7">{A.setupSteps}</p>
        </details>
      </section>

      {groups.map((g) => (
        <section key={g} className="card space-y-2 overflow-x-auto">
          <h2 className="font-bold">{A.audiences[g]}</h2>
          {g !== "customer" && <p className="text-xs text-muted">{A.alarmHelp}</p>}
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line">
              <th className="py-1 text-start">{A.event}</th><th className="text-start">{A.who}</th><th>{A.sms}</th><th>{A.alarm}</th><th>{A.active}</th><th />
            </tr></thead>
            <tbody>
              {a.events.filter((e) => e.audience === g).map((e) => (
                <tr key={e.code} className="border-b border-line last:border-0">
                  <td className="py-2">{e.label[locale] ?? e.label.fa}</td>
                  <td className="text-xs text-muted" dir="ltr">{e.permission ?? "—"}</td>
                  <td colSpan={4}>
                    <form action={saveEvent} className="flex items-center justify-around gap-2">
                      <input type="hidden" name="locale" value={locale} /><input type="hidden" name="code" value={e.code} />
                      <input type="checkbox" name="sms" defaultChecked={e.sms} aria-label={A.sms} className="h-4 w-4 accent-brand-600" />
                      <input type="checkbox" name="alarm" defaultChecked={e.alarm} aria-label={A.alarm} className="h-4 w-4 accent-brand-600" />
                      <input type="checkbox" name="active" defaultChecked={e.active} aria-label={A.active} className="h-4 w-4 accent-brand-600" />
                      <SubmitButton className="btn-ghost py-1 text-xs">{A.save}</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">{A.log}</h2>
        <table className="w-full text-xs">
          <thead className="text-muted"><tr className="border-b border-line"><th className="py-1 text-start">{A.event}</th><th className="text-start">—</th><th>Push</th><th>{A.sms}</th></tr></thead>
          <tbody>
            {a.log.map((n) => (
              <tr key={n.id} className="border-b border-line last:border-0">
                <td className="py-1">{n.title}</td><td className="text-muted">{when(n.at)}</td>
                <td className="text-center">{A.status[n.push] ?? n.push}</td><td className="text-center">{A.status[n.sms] ?? n.sms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
