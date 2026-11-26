import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { getReviewerTexts } from "@/i18n/dictionaries/reviewers";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type B = { user_id: string; display_name: string; specialty: string; reviews: number; answers: number; points: number; minutes: number; accrued_rial: number; paid_rial: number; has_iban: boolean };
type H = { id: string; user_id: string; amount_rial: number; credits: number; note: string | null; paid_at: string };

async function pay(fd: FormData) {
  "use server";
  const r = String(fd.get("locale") ?? "fa");
  const locale = isLocale(r) ? r : "fa";
  const { error } = await (await createClient()).rpc("payout_mark", { p_user: String(fd.get("id")), p_note: String(fd.get("note") ?? "") });
  revalidatePath(`/${locale}/admin/reviewers`);
  redirect(`/${locale}/admin/reviewers?r=${error ? "failed" : "done"}`);
}

export default async function ReviewersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user, supabase } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/reviewers`);
  const R = getReviewerTexts(locale), A = R.admin, C = getConsultTexts(locale);
  const sp = await searchParams;
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const mine = (perms as string[] | null) ?? [];
  if (!mine.includes("consult.manage")) return <div className="space-y-4"><AdminTabs locale={locale} current="dashboard" labels={getRules(locale)} /><ErrorBox message={A.forbidden} /></div>;
  const canPay = mine.includes("consult.payout");
  const [{ data: bal }, { data: his }, { data: pi }] = await Promise.all([
    supabase.rpc("reviewer_balances"),
    supabase.from("payout_batches").select("id, user_id, amount_rial, credits, note, paid_at").order("paid_at", { ascending: false }).limit(15),
    canPay ? supabase.from("expert_payout_info").select("user_id, holder_name, iban") : Promise.resolve({ data: [] }),
  ]);
  const info = new Map(((pi as { user_id: string; holder_name: string; iban: string }[] | null) ?? []).map((i) => [i.user_id, i]));
  const rows = (bal as B[] | null) ?? [], hist = (his as H[] | null) ?? [];
  const names = new Map(rows.map((b) => [b.user_id, b.display_name]));
  const n = (v: number) => formatNumber(Math.round(Number(v)), locale);
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="reviewers" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{A.title}</h1>
      <p className="max-w-3xl text-sm leading-7 text-muted">{A.intro}</p>
      <p className="max-w-3xl text-xs text-amber-800">{A.hint}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link className="text-brand-700 underline" href={`/${locale}/admin/settings?tab=community`}>{A.settings}</Link>
        <Link className="text-brand-700 underline" href={`/${locale}/forum/review`}>{A.queueLink}</Link>
      </div>
      {sp.r === "done" && <OkBox message={A.done} />}
      {sp.r === "failed" && <ErrorBox message={A.failed} />}
      {!canPay && <p className="text-sm text-amber-800">{A.canNotPay}</p>}

      {rows.length === 0 && <p className="card text-muted">{A.none}</p>}
      <div className="space-y-2">
        {rows.map((b) => (
          <form key={b.user_id} action={pay} className="card flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={b.user_id} />
            <div className="min-w-40 flex-1"><b>{b.display_name}</b><div className="text-xs text-muted">{C.specialties[b.specialty] ?? b.specialty}</div></div>
            <div><span className="text-muted">{A.reviews}: </span>{n(b.reviews)} · <span className="text-muted">{A.answers}: </span>{n(b.answers)}</div>
            <div><span className="text-muted">{A.points}: </span>{n(b.points)} · <span className="text-muted">{A.minutes}: </span>{n(b.minutes)}</div>
            <div><span className="text-muted">{A.accrued}: </span><b>{n(b.accrued_rial)}</b></div>
            <div><span className="text-muted">{A.paid}: </span>{n(b.paid_rial)}</div>
            <div className="text-xs"><span className="text-muted">{A.iban}: </span>{b.has_iban ? A.yes : A.no}</div>
            {canPay && info.get(b.user_id) && <div className="w-full text-xs" dir="ltr">{info.get(b.user_id)!.holder_name} · {info.get(b.user_id)!.iban}</div>}
            {canPay && Number(b.accrued_rial) > 0 && (
              <>
                <input name="note" maxLength={200} placeholder={A.note} className="input max-w-52" />
                <SubmitButton className="btn">{A.pay}</SubmitButton>
              </>
            )}
          </form>
        ))}
      </div>

      <h2 className="font-bold">{A.history}</h2>
      {hist.length === 0 && <p className="text-muted">{A.noHistory}</p>}
      <ul className="space-y-1 text-sm">
        {hist.map((h) => (
          <li key={h.id} className="card flex flex-wrap gap-3">
            <b>{names.get(h.user_id) ?? "—"}</b><span>{n(h.amount_rial)} {R.rial}</span><span className="text-muted">{df.format(new Date(h.paid_at))}</span>
            {h.note && <span className="text-muted">{h.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
