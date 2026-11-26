import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { getQualTexts } from "@/i18n/dictionaries/qualification";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type X = { user_id: string; display_name: string; specialty: string; license_no: string | null; bio: string | null; status: string; basis: string;
  qualification_note: string | null; status_reason: string | null; paused_until: string | null; applied_at: string; eligible_pharmacist: boolean;
  late_n: number; wrong_n: number; good_n: number; reviews_30d: number; avg_minutes: number | null };
type Q = { source: "forum" | "answer"; id: string; body: string; state: string; note: string | null; reviewer_id: string; reviewer_name: string | null; minutes: number | null };
type Ev = { id: number; kind: string; note: string | null; internal_note: string | null; auto: boolean; created_at: string };

const loc = (fd: FormData) => { const r = String(fd.get("locale") ?? "fa"); return isLocale(r) ? r : "fa"; };
const back = (locale: string, r: string, extra = "") => { revalidatePath("/", "layout"); redirect(`/${locale}/admin/experts?r=${r}${extra}`); };

async function setStatus(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { data, error } = await (await createClient()).rpc("reviewer_set_status", {
    p_user: String(fd.get("id")), p_action: String(fd.get("act")), p_reason: String(fd.get("reason") ?? ""),
    p_days: Number(fd.get("days") ?? 0) || 0, p_internal: String(fd.get("internal") ?? ""),
  });
  back(locale, error ? "forbidden" : String(data ?? "state"));
}
async function audit(fd: FormData) {
  "use server";
  const locale = loc(fd);
  const { data, error } = await (await createClient()).rpc("reviewer_audit", {
    p_source: String(fd.get("source")), p_id: String(fd.get("id")), p_verdict: String(fd.get("verdict")), p_note: String(fd.get("note") ?? ""),
  });
  back(locale, error ? "forbidden" : String(data ?? "missing"), "#audit");
}

export default async function ExpertsAdmin({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string; u?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user, supabase } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/experts`);
  const Q = getQualTexts(locale), C = getConsultTexts(locale);
  const sp = await searchParams;
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  if (!((perms as string[] | null) ?? []).includes("consult.manage")) {
    return <div className="space-y-4"><AdminTabs locale={locale} current="dashboard" labels={getRules(locale)} /><ErrorBox message={Q.res.forbidden} /></div>;
  }
  const [{ data: ex }, { data: aq }, { data: evs }] = await Promise.all([
    supabase.rpc("reviewer_admin_list"),
    supabase.rpc("reviewer_audit_queue", { p_limit: 6 }),
    sp.u ? supabase.rpc("reviewer_events_list", { p_user: sp.u, p_limit: 40 }) : Promise.resolve({ data: [] }),
  ]);
  const list = (ex as X[] | null) ?? [], queue = (aq as Q[] | null) ?? [], events = (evs as Ev[] | null) ?? [];
  const n = (v: number | null) => formatNumber(Number(v ?? 0), locale);
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const groups: [string, X[]][] = [
    [Q.pending, list.filter((x) => x.status === "pending")],
    [Q.active, list.filter((x) => x.status === "approved")],
    [Q.stopped, list.filter((x) => ["paused", "suspended", "removed"].includes(x.status))],
  ];
  const acts: Record<string, string[]> = {
    pending: ["approve", "reject"], approved: ["warn", "pause", "suspend", "remove"],
    paused: ["reinstate", "suspend", "remove"], suspended: ["reinstate", "remove"], removed: ["approve"],
  };

  return (
    <div className="space-y-8">
      <AdminTabs locale={locale} current="experts" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{Q.title}</h1>
      <p className="max-w-3xl text-sm leading-7 text-muted">{Q.intro}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link className="text-brand-700 underline" href={`/${locale}/admin/settings?tab=community`}>{Q.settingsLink}</Link>
        <Link className="text-brand-700 underline" href={`/${locale}/forum/review`}>{Q.reviewLink}</Link>
      </div>
      {sp.r && (sp.r === "ok" ? <OkBox message={Q.res.ok} /> : <ErrorBox message={Q.res[sp.r] ?? Q.res.state} />)}

      {groups.map(([title, rows]) => (
        <section key={title} className="space-y-3">
          <h2 className="text-lg font-bold">{title} <span className="text-sm font-normal text-muted">({n(rows.length)})</span></h2>
          {rows.length === 0 && <p className="text-muted">{Q.none}</p>}
          {rows.map((x) => (
            <form key={x.user_id} action={setStatus} className="card space-y-3 text-sm">
              <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={x.user_id} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <b className="text-base">{x.display_name}</b>
                <span className="text-muted">{C.specialties[x.specialty] ?? x.specialty}</span>
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs">{Q.status[x.status]}</span>
                {x.status !== "pending" && <span className="text-xs text-muted">{Q.basis[x.basis]}</span>}
                {x.paused_until && <span className="text-xs text-amber-800">{Q.until} {df.format(new Date(x.paused_until))}</span>}
                <span className="ms-auto text-xs text-muted">{Q.applied}: {df.format(new Date(x.applied_at))}</span>
              </div>
              {x.license_no && <p className="text-xs" dir="ltr">{Q.license}: {x.license_no}</p>}
              {x.bio && <p className="text-muted">{x.bio}</p>}
              {x.status === "pending" && (
                <p className={x.eligible_pharmacist ? "font-bold text-green-800" : "text-amber-800"}>{x.eligible_pharmacist ? Q.eligible : Q.notEligible}</p>
              )}
              {x.qualification_note && x.status !== "pending" && <p className="text-xs text-muted">{Q.basisLabel.split(" (")[0]}: {x.qualification_note}</p>}
              {x.status_reason && <p className="text-xs text-red-700">{Q.reason}: {x.status_reason}</p>}
              {x.status === "approved" && (
                <p className="text-xs">{Q.stats}: <b>{n(x.late_n)} / {n(x.wrong_n)} / {n(x.good_n)}</b> · {Q.reviews30}: {n(x.reviews_30d)} · {Q.avgMin}: {n(x.avg_minutes)}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <textarea name="reason" rows={2} maxLength={600} placeholder={x.status === "pending" || x.status === "removed" ? Q.basisLabel : Q.reasonLabel} className="input sm:col-span-2" />
                <input name="internal" maxLength={600} placeholder={Q.internalLabel} className="input" />
                <input name="days" type="number" min={1} max={365} placeholder={`${Q.act.pause}: ${Q.daysLabel}`} className="input" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(acts[x.status] ?? []).map((a) => (
                  <SubmitButton key={a} name="act" value={a} className={a === "approve" || a === "reinstate" ? "btn" : "btn-ghost"}>{Q.act[a]}</SubmitButton>
                ))}
                <Link className="ms-auto text-xs text-brand-700 underline" href={`/${locale}/admin/experts?u=${x.user_id}#h-${x.user_id}`}>{Q.historyOpen}</Link>
              </div>
              {sp.u === x.user_id && (
                <ul id={`h-${x.user_id}`} className="space-y-1 border-t border-line pt-2 text-xs">
                  {events.length === 0 && <li className="text-muted">{Q.none}</li>}
                  {events.map((e) => (
                    <li key={e.id}>
                      <b>{Q.ev[e.kind] ?? e.kind}</b> · <span className="text-muted">{df.format(new Date(e.created_at))}{e.auto ? ` · ${Q.auto}` : ""}</span>
                      {e.note && <> — {e.note}</>}{e.internal_note && <span className="text-amber-800"> [{e.internal_note}]</span>}
                    </li>
                  ))}
                </ul>
              )}
            </form>
          ))}
        </section>
      ))}

      <section id="audit" className="space-y-3">
        <h2 className="text-lg font-bold">{Q.audit.title}</h2>
        <p className="max-w-3xl text-sm text-muted">{Q.audit.intro}</p>
        {queue.length === 0 && <p className="text-muted">{Q.audit.empty}</p>}
        {queue.map((q) => (
          <form key={q.source + q.id} action={audit} className="card space-y-2">
            <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={q.id} /><input type="hidden" name="source" value={q.source} />
            <p className="text-xs text-muted">{q.source === "forum" ? Q.audit.forum : Q.audit.answer} · {Q.audit.by} <b>{q.reviewer_name ?? "—"}</b>{q.minutes ? ` · ${n(q.minutes)}′` : ""}</p>
            <p className="line-clamp-5 whitespace-pre-line text-sm leading-7">{q.body}</p>
            {q.note && <p className="text-xs text-amber-800">{q.note}</p>}
            <input name="note" maxLength={600} placeholder={Q.audit.note} className="input" />
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="verdict" value="good" className="btn">{Q.audit.good}</SubmitButton>
              <SubmitButton name="verdict" value="unclear" className="btn-ghost">{Q.audit.unclear}</SubmitButton>
              <SubmitButton name="verdict" value="wrong" className="btn-ghost text-red-700">{Q.audit.wrong}</SubmitButton>
            </div>
          </form>
        ))}
        <Link className="text-sm text-brand-700 underline" href={`/${locale}/admin/experts#audit`}>{Q.audit.reload}</Link>
      </section>
    </div>
  );
}
