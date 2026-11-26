import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getForumTexts } from "@/i18n/dictionaries/forum";
import { getReviewerTexts } from "@/i18n/dictionaries/reviewers";
import { getQualTexts } from "@/i18n/dictionaries/qualification";
import { isConfigured } from "@/lib/config";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type P = { id: string; parent_id: string | null; title: string | null; body: string; review_state: string; status: string; claimed_by: string | null; claimed_until: string | null };
const COLS = "id, parent_id, title, body, review_state, status, claimed_by, claimed_until";
const back = (locale: string, q = "") => { revalidatePath(`/${locale}/forum`, "layout"); redirect(`/${locale}/forum/review${q}`); };
const lc = (fd: FormData) => { const r = String(fd.get("locale") ?? "fa"); return isLocale(r) ? r : "fa"; };

async function claim(fd: FormData) {
  "use server";
  const locale = lc(fd);
  const { supabase } = await getUser();
  const { error } = await supabase.rpc("forum_claim", { p_count: 1 });
  back(locale, error ? `?e=${error.code === "P0001" ? "cap" : error.code === "P0002" ? "many" : "claim"}` : "");
}
async function release(fd: FormData) {
  "use server";
  const { supabase } = await getUser();
  await supabase.rpc("forum_release", { p_id: String(fd.get("id")) });
  back(lc(fd));
}
async function decide(fd: FormData) {
  "use server";
  const locale = lc(fd);
  const { supabase } = await getUser();
  const op = String(fd.get("op"));
  const note = String(fd.get("note") ?? "").trim().slice(0, 2000);
  const patch: Record<string, unknown> =
    op === "verify" ? { review_state: "verified", review_note: note || null }
    : op === "none" ? { review_state: "not_needed", review_note: null }
    : op === "correct" ? { review_state: "corrected", review_note: note }
    : op === "reopen" ? { review_state: "pending", review_note: null }
    : op === "hide" ? { status: "hidden" } : { status: "visible" };
  const { data, error } = await supabase.from("forum_posts").update(patch).eq("id", String(fd.get("id"))).select("id");
  back(locale, error || !data?.length ? "?e=decide" : "");
}
async function savePay(fd: FormData) {
  "use server";
  const locale = lc(fd);
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login`);
  const iban = String(fd.get("iban") ?? "").replace(/\s/g, "").toUpperCase();
  const { error } = await supabase.from("expert_payout_info").upsert(
    { user_id: user.id, holder_name: String(fd.get("holder") ?? "").trim(), iban, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  back(locale, error ? "?e=pay" : "?ok=pay");
}

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const F = getForumTexts(locale), A = F.admin, R = getReviewerTexts(locale);
  const sp = await searchParams;
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/forum/review`);
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const staff = ((perms as string[] | null) ?? []).includes("consult.manage");
  type St = { status: string; reason: string | null; paused_until: string | null; basis: string; late_n: number; wrong_n: number; late_limit: number; wrong_limit: number; window_days: number };
  const { data: stRows } = await supabase.rpc("my_reviewer_status");
  const st0 = ((stRows as St[] | null) ?? [])[0];
  const me = st0?.status === "approved" ? st0 : null;
  if (!staff && !st0) return <ErrorBox message={A.forbidden} />;
  const Q = getQualTexts(locale);
  const { data: fb } = st0 ? await supabase.rpc("my_reviewer_events", { p_limit: 15 }) : { data: [] };
  const feedback = (fb as { id: number; kind: string; note: string | null; created_at: string }[] | null) ?? [];
  const dfmt = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium" });

  const now = Date.now();
  const [{ data: mine }, { data: pend }, { data: rec }, { data: st }, { data: pay }] = await Promise.all([
    supabase.from("forum_posts").select(COLS).eq("claimed_by", user.id).gt("claimed_until", new Date().toISOString()).eq("review_state", "pending").order("created_at"),
    supabase.from("forum_posts").select(COLS).eq("review_state", "pending").eq("status", "visible").order("created_at").limit(40),
    supabase.from("forum_posts").select(COLS).eq("reviewed_by", user.id).order("reviewed_at", { ascending: false }).limit(8),
    supabase.rpc("my_review_stats"),
    supabase.from("expert_payout_info").select("holder_name, iban").eq("user_id", user.id).maybeSingle(),
  ]);
  const myClaims = (mine as P[] | null) ?? [], pending = (pend as P[] | null) ?? [], recent = (rec as P[] | null) ?? [];
  const stats = ((st as { accrued_rial: number; accrued_points: number; paid_rial: number; reviews_today: number; answers_today: number }[] | null) ?? [])[0];
  const open = pending.filter((p) => !p.claimed_until || new Date(p.claimed_until).getTime() < now);
  const n = (v: number) => formatNumber(Math.round(v), locale);
  const hid = (id: string) => (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={id} /></>);
  const errMsg = sp.e === "cap" ? R.cap : sp.e === "many" ? R.tooMany : sp.e === "claim" ? R.claimFailed : sp.e === "decide" ? R.decideFailed : sp.e === "pay" ? R.payBad : "";

  const DecideForm = ({ p, claimed }: { p: P; claimed: boolean }) => (
    <form action={decide} className="card space-y-2">
      {hid(p.id)}
      {p.parent_id
        ? <Link className="text-xs text-brand-700 underline" href={`/${locale}/forum/${p.parent_id}`}>{A.thread} →</Link>
        : <Link className="font-bold" href={`/${locale}/forum/${p.id}`}>{p.title}</Link>}
      <p className="whitespace-pre-line text-sm leading-7">{p.body}</p>
      {claimed && p.claimed_until && <p className="text-xs text-muted">⏱ {n((new Date(p.claimed_until).getTime() - now) / 60000)} {R.minLeft}</p>}
      <textarea name="note" rows={2} maxLength={2000} placeholder={A.note} className="input" />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="op" value="verify" className="btn">{A.verify}</SubmitButton>
        <SubmitButton name="op" value="correct" className="btn-ghost">{A.correct}</SubmitButton>
        <SubmitButton name="op" value="none" className="btn-ghost">{A.notNeeded}</SubmitButton>
        {staff && <SubmitButton name="op" value="hide" className="btn-ghost">{A.hide}</SubmitButton>}
      </div>
    </form>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${locale}/forum`} className="text-sm text-brand-700 underline">{F.back}</Link>
      <h1 className="text-xl font-extrabold">{A.queue}</h1>
      {errMsg && <ErrorBox message={errMsg} />}
      {sp.ok === "pay" && <OkBox message={R.paySaved} />}

      {st0 && (
        <section className={`card space-y-2 ${st0.status === "approved" ? "" : "border-amber-400"}`}>
          <h2 className="font-bold">{Q.me.title}</h2>
          <p className="text-sm">{(Q.me as Record<string, string>)[st0.status]}{st0.basis === "pharmacist_verified" && st0.status === "approved" ? ` ${Q.me.pharm}` : ""}</p>
          {st0.reason && st0.status !== "approved" && <p className="text-sm text-red-700">{Q.reason}: {st0.reason}</p>}
          {st0.paused_until && st0.status === "paused" && <p className="text-xs text-muted">{Q.me.back}: {dfmt.format(new Date(st0.paused_until))}</p>}
          {st0.status !== "pending" && (
            <p className="text-xs text-muted">
              {Q.me.late}: <b>{n(st0.late_n)}</b>{st0.late_limit > 0 ? ` / ${Q.me.limit} ${n(st0.late_limit)}` : ""} · {Q.me.wrong}: <b>{n(st0.wrong_n)}</b>{st0.wrong_limit > 0 ? ` / ${Q.me.limit} ${n(st0.wrong_limit)}` : ""} · {Q.me.inWindow.replace("{d}", n(st0.window_days))}
            </p>
          )}
          {st0.status !== "approved" && st0.status !== "pending" && <p className="text-xs text-muted">{Q.me.contact}</p>}
          <h3 className="pt-1 text-sm font-bold">{Q.me.feedback}</h3>
          {feedback.length === 0 && <p className="text-xs text-muted">{Q.me.none}</p>}
          <ul className="space-y-1 text-xs">
            {feedback.map((f) => (
              <li key={f.id}><b>{Q.ev[f.kind] ?? f.kind}</b> <span className="text-muted">· {dfmt.format(new Date(f.created_at))}</span>{f.note ? <> — {f.note}</> : null}</li>
            ))}
          </ul>
        </section>
      )}

      {me && stats && (
        <section className="card space-y-2">
          <h2 className="font-bold">{R.myStats}</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">{R.points}</dt><dd className="font-bold">{n(stats.accrued_points)}</dd></div>
            <div><dt className="text-muted">{R.accrued}</dt><dd className="font-bold">{n(stats.accrued_rial)} {R.rial}</dd></div>
            <div><dt className="text-muted">{R.paid}</dt><dd className="font-bold">{n(stats.paid_rial)} {R.rial}</dd></div>
            <div><dt className="text-muted">{R.today}</dt><dd className="font-bold">{n(stats.reviews_today)}</dd></div>
            <div><dt className="text-muted">{R.answersToday}</dt><dd className="font-bold">{n(stats.answers_today)}</dd></div>
          </dl>
        </section>
      )}

      {me && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-bold">{R.claimedTitle}</h2>
            <span className="text-xs text-muted">{n(open.length)} {R.queueSize}</span>
            <form action={claim} className="ms-auto"><input type="hidden" name="locale" value={locale} /><SubmitButton className="btn">{R.claimNext}</SubmitButton></form>
          </div>
          {myClaims.length === 0 && <p className="card text-muted">{open.length === 0 ? R.nothing : R.noClaimed}</p>}
          {myClaims.map((p) => (
            <div key={p.id} className="space-y-1">
              <DecideForm p={p} claimed />
              <form action={release}>{hid(p.id)}<SubmitButton className="text-xs text-muted underline">{R.release}</SubmitButton></form>
            </div>
          ))}
        </section>
      )}

      {staff && (
        <section className="space-y-3">
          <h2 className="font-bold">{R.staffQueue}</h2>
          {pending.length === 0 && <p className="card text-muted">{A.empty}</p>}
          {pending.filter((p) => p.claimed_by !== user.id).map((p) => (
            <div key={p.id}>
              {p.claimed_until && new Date(p.claimed_until).getTime() > now && <p className="mb-1 text-xs text-amber-700">{R.claimedBy}</p>}
              <DecideForm p={p} claimed={false} />
            </div>
          ))}
        </section>
      )}

      {recent.length > 0 && <h2 className="font-bold">{A.recent}</h2>}
      {recent.map((p) => (
        <form key={p.id} action={decide} className="card flex flex-wrap items-center gap-2 text-sm">
          {hid(p.id)}
          <span className="min-w-0 flex-1 truncate">{p.title ?? p.body}</span>
          <span className="text-xs text-muted">{F.review[p.review_state] || "—"}</span>
          {staff && <SubmitButton name="op" value="reopen" className="btn-ghost">{A.reopen}</SubmitButton>}
        </form>
      ))}

      {me && (
        <form action={savePay} className="card space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <h2 className="font-bold">{R.payInfo}</h2>
          <p className="text-xs text-muted">{R.payNote}</p>
          <div><label className="label" htmlFor="ph">{R.holder}</label><input id="ph" name="holder" required minLength={3} maxLength={80} defaultValue={pay?.holder_name ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="pi">{R.iban}</label><input id="pi" name="iban" required dir="ltr" pattern="IR[0-9]{24}" maxLength={26} defaultValue={pay?.iban ?? ""} className="input" /></div>
          <SubmitButton className="btn">{R.savePay}</SubmitButton>
        </form>
      )}
    </div>
  );
}
