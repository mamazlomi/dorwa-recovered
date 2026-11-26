import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { isConfigured } from "@/lib/config";
import { pageMeta } from "@/lib/seo";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Q = { id: string; title: string; topic: string; status: string; is_public: boolean; created_at: string };
const TOPICS = ["general", "drug", "pregnancy", "child", "skin", "supplement", "elderly", "other"];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  const C = getConsultTexts(locale);
  return pageMeta({ locale, path: "/consult", title: C.forumTitle, description: C.forumIntro });
}

async function askQuestion(fd: FormData) {
  "use server";
  const raw = String(fd.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/consult`);
  const topic = TOPICS.includes(String(fd.get("topic"))) ? String(fd.get("topic")) : "general";
  const { data, error } = await supabase.from("consult_questions").insert({
    title: String(fd.get("title") ?? "").trim().slice(0, 140),
    body: String(fd.get("body") ?? "").trim().slice(0, 2000),
    topic, is_public: fd.get("public") === "on",
  }).select("id").single();
  if (error || !data) redirect(`/${locale}/consult?e=${error?.code === "P0001" ? "limit" : "failed"}`);
  redirect(`/${locale}/consult/${data.id}`);
}

export default async function ForumPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ topic?: string; e?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const C = getConsultTexts(locale);
  const sp = await searchParams;
  const topic = TOPICS.includes(sp.topic ?? "") ? sp.topic! : "";
  const { supabase, user } = await getUser();

  let query = supabase.from("consult_questions").select("id, title, topic, status, is_public, created_at")
    .eq("is_public", true).in("status", ["open", "answered"]).order("created_at", { ascending: false }).limit(40);
  if (topic) query = query.eq("topic", topic);
  const { data } = await query;
  const list = (data as Q[] | null) ?? [];
  const { data: counts } = list.length ? await supabase.rpc("consult_answer_counts", { p_ids: list.map((q) => q.id) }) : { data: [] };
  const cnt = new Map(((counts as { question_id: string; answers: number; verified: number }[] | null) ?? []).map((c) => [c.question_id, c]));
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="card bg-gradient-to-l from-brand-50 to-white">
        <h1 className="mb-2 text-2xl font-extrabold">{C.forumTitle}</h1>
        <p className="text-sm leading-7 text-muted">{C.forumIntro}</p>
        <p className="mt-2 text-xs text-muted">{C.disclaimer}</p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link className="text-brand-700 underline" href={`/${locale}/consult/consultant`}>{C.becomeLink}</Link>
          <Link className="text-brand-700 underline" href={`/${locale}/magazine`}>{C.magazine}</Link>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold">{C.askTitle}</h2>
        {sp.e && <ErrorBox message={sp.e === "limit" ? C.limit : C.failed} />}
        {user ? (
          <form action={askQuestion} className="space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <div><label className="label" htmlFor="q-title">{C.titleLabel}</label>
              <input id="q-title" name="title" required minLength={5} maxLength={140} className="input" /></div>
            <div><label className="label" htmlFor="q-body">{C.bodyLabel}</label>
              <textarea id="q-body" name="body" required minLength={10} maxLength={2000} rows={5} className="input" /></div>
            <div><label className="label" htmlFor="q-topic">{C.topic}</label>
              <select id="q-topic" name="topic" className="input">{TOPICS.map((k) => <option key={k} value={k}>{C.topics[k]}</option>)}</select></div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="public" className="mt-1" /> <span>{C.makePublic}</span></label>
            <p className="text-xs text-muted">{C.privateNote}</p>
            <SubmitButton className="btn w-full">{C.ask}</SubmitButton>
          </form>
        ) : (
          <Link className="btn" href={`/${locale}/login?next=/${locale}/consult`}>{C.loginToAsk}</Link>
        )}
      </section>

      <form method="get" className="flex gap-2">
        <select name="topic" defaultValue={topic} aria-label={C.topic} className="input">
          <option value="">{C.all}</option>
          {TOPICS.map((k) => <option key={k} value={k}>{C.topics[k]}</option>)}
        </select>
        <button className="btn-ghost">{C.filter}</button>
      </form>

      {list.length === 0 ? <p className="card text-center text-muted">{C.empty}</p> : (
        <ul className="space-y-2">
          {list.map((q) => {
            const c = cnt.get(q.id);
            return (
              <li key={q.id}>
                <Link href={`/${locale}/consult/${q.id}`} className="card block hover:bg-brand-50">
                  <div className="font-bold">{q.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{C.topics[q.topic] ?? q.topic}</span><span>·</span><span>{df.format(new Date(q.created_at))}</span><span>·</span>
                    <span>{c ? `${formatNumber(c.answers, locale)} ${C.answersN}` : C.unanswered}</span>
                    {c && c.verified > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 font-bold text-green-800">✓ {C.verified}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
