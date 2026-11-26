import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, resolveLocale } from "@/i18n";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Q = { id: string; title: string; body: string; topic: string; is_public: boolean; status: string; created_at: string; asker_id: string };
type A = { id: string; author_id: string; body: string; verified: boolean; created_at: string };
type E = { user_id: string; display_name: string; specialty: string; bio: string | null };

async function answer(fd: FormData) {
  "use server";
  const raw = String(fd.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(fd.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("consult_answers").insert({ question_id: id, body: String(fd.get("body") ?? "").trim().slice(0, 3000) });
  revalidatePath(`/${locale}/forum/${id}`);
  redirect(`/${locale}/forum/${id}${error ? "?e=1" : ""}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("consult_questions").select("title, is_public").eq("id", id).maybeSingle();
  // private questions are never indexed
  return { title: data?.title ?? "—", robots: data?.is_public ? undefined : { index: false } };
}

export default async function QuestionPage({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ e?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const C = getConsultTexts(locale);
  const sp = await searchParams;
  const { supabase, user } = await getUser();

  const { data: qd } = await supabase.from("consult_questions").select("id, title, body, topic, is_public, status, created_at, asker_id").eq("id", id).maybeSingle();
  const q = qd as Q | null;
  if (!q) notFound();
  const { data: ad } = await supabase.from("consult_answers").select("id, author_id, body, verified, created_at").eq("question_id", id).eq("status", "visible").order("created_at");
  const answers = (ad as A[] | null) ?? [];
  const ids = [...new Set(answers.map((a) => a.author_id)), ...(user ? [user.id] : [])];
  const { data: ed } = ids.length ? await supabase.from("consult_experts").select("user_id, display_name, specialty, bio").in("user_id", ids).eq("status", "approved") : { data: [] };
  const experts = new Map(((ed as E[] | null) ?? []).map((e) => [e.user_id, e]));
  const iAmExpert = Boolean(user && experts.has(user.id));
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/${locale}/forum`} className="text-sm text-brand-700 underline">{C.back}</Link>
      <article className="card space-y-2">
        <h1 className="text-xl font-extrabold">{q.title}</h1>
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          <span>{C.topics[q.topic] ?? q.topic}</span><span>·</span><span>{df.format(new Date(q.created_at))}</span>
          {!q.is_public && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{C.private}</span>}
        </div>
        <p className="whitespace-pre-line leading-8">{q.body}</p>
      </article>
      <p className="text-xs text-muted">{C.disclaimer}</p>

      <section className="space-y-3">
        <h2 className="font-bold">{C.answers}</h2>
        {sp.e && <ErrorBox message={C.failed} />}
        {answers.length === 0 && <p className="card text-muted">{C.noAnswers}</p>}
        {answers.map((a) => {
          const e = experts.get(a.author_id);
          return (
            <div key={a.id} className={`card space-y-2 ${a.verified ? "border-green-300 bg-green-50/50" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>{e?.display_name ?? "—"}</b>
                {e && <span className="text-muted">{C.specialties[e.specialty] ?? e.specialty}</span>}
                {a.verified && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">✓ {C.verified}</span>}
                <span className="ms-auto text-xs text-muted">{df.format(new Date(a.created_at))}</span>
              </div>
              <p className="whitespace-pre-line leading-8">{a.body}</p>
            </div>
          );
        })}
      </section>

      {iAmExpert && (
        <form action={answer} className="card space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={q.id} />
          <label className="label" htmlFor="ans">{C.yourAnswer}</label>
          <textarea id="ans" name="body" required minLength={10} maxLength={3000} rows={6} className="input" />
          <SubmitButton className="btn w-full">{C.sendAnswer}</SubmitButton>
        </form>
      )}
    </div>
  );
}
