import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, resolveLocale } from "@/i18n";
import { getForumTexts } from "@/i18n/dictionaries/forum";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { getReviewerTexts } from "@/i18n/dictionaries/reviewers";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type P = { reviewer_name: string | null; reviewer_specialty: string | null; id: string; parent_id: string | null; author_id: string; title: string | null; body: string; category: string; review_state: string; review_note: string | null; reviewed_by: string | null; created_at: string };
type E = { user_id: string; display_name: string };

async function comment(fd: FormData) {
  "use server";
  const raw = String(fd.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(fd.get("id") ?? "");
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/forum/${id}`);
  const { error } = await supabase.from("forum_posts").insert({ parent_id: id, body: String(fd.get("body") ?? "").trim().slice(0, 3000) });
  revalidatePath(`/${locale}/forum/${id}`);
  redirect(`/${locale}/forum/${id}${error ? `?e=${error.code === "P0001" ? "limit" : "failed"}` : ""}`);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const { data } = await (await createClient()).from("forum_posts").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "—" };
}

function ReviewBox({ p, F, locale }: { p: P; F: ReturnType<typeof getForumTexts>; locale: "fa" | "en" | "ar" }) {
  if (p.review_state === "not_needed") return null;
  if (p.review_state === "pending") return <p className="text-xs text-muted">⏳ {F.review.pending}</p>;
  const spec = p.reviewer_specialty === "staff" ? getReviewerTexts(locale).staffTitle : p.reviewer_specialty ? getConsultTexts(locale).specialties[p.reviewer_specialty] ?? "" : "";
  return (
    <div className={`rounded-lg border p-3 text-sm ${p.review_state === "verified" ? "border-green-300 bg-green-50" : "border-blue-300 bg-blue-50"}`} lang={locale}>
      <b>{p.review_state === "verified" ? "✓ " : "ℹ "}{F.review[p.review_state]}</b>
      {p.reviewer_name && <span className="text-muted"> — {F.reviewedBy} <b className="text-foreground">{p.reviewer_name}</b>{spec ? ` (${spec})` : ""}</span>}
      {p.review_note && <p className="mt-1 whitespace-pre-line leading-7">{p.review_note}</p>}
    </div>
  );
}

export default async function ThreadPage({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ e?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const F = getForumTexts(locale);
  const sp = await searchParams;
  const { supabase, user } = await getUser();

  const { data: th } = await supabase.from("forum_posts").select("id, parent_id, author_id, title, body, category, review_state, review_note, reviewed_by, reviewer_name, reviewer_specialty, created_at").eq("id", id).is("parent_id", null).maybeSingle();
  const thread = th as P | null;
  if (!thread) notFound();
  const { data: cd } = await supabase.from("forum_posts").select("id, parent_id, author_id, title, body, category, review_state, review_note, reviewed_by, reviewer_name, reviewer_specialty, created_at").eq("parent_id", id).eq("status", "visible").order("created_at");
  const comments = (cd as P[] | null) ?? [];
  const ids = [...new Set([thread, ...comments].flatMap((p) => [p.author_id, p.reviewed_by].filter(Boolean) as string[]))];
  const { data: ed } = ids.length ? await supabase.from("consult_experts").select("user_id, display_name").in("user_id", ids).eq("status", "approved") : { data: [] };
  const experts = new Map(((ed as E[] | null) ?? []).map((e) => [e.user_id, e.display_name]));
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/${locale}/forum`} className="text-sm text-brand-700 underline">{F.back}</Link>
      <article className="card space-y-3">
        <h1 className="text-xl font-extrabold">{thread.title}</h1>
        <div className="text-xs text-muted">{F.categories[thread.category] ?? thread.category} · {df.format(new Date(thread.created_at))}</div>
        <p className="whitespace-pre-line leading-8">{thread.body}</p>
        <ReviewBox p={thread} F={F} locale={locale} />
      </article>
      <p className="text-xs text-muted">{F.disclaimer}</p>

      <section className="space-y-3">
        <h2 className="font-bold">{F.commentsTitle}</h2>
        {sp.e && <ErrorBox message={sp.e === "limit" ? F.limit : F.failed} />}
        {comments.length === 0 && <p className="card text-muted">{F.noComments}</p>}
        {comments.map((c) => {
          const name = experts.get(c.author_id);
          return (
            <div key={c.id} className="card space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted">
                {name && <span className="rounded-full bg-brand-100 px-2 py-0.5 font-bold text-brand-800">{F.expertBadge}: {name}</span>}
                <span className="ms-auto">{df.format(new Date(c.created_at))}</span>
              </div>
              <p className="whitespace-pre-line leading-8">{c.body}</p>
              <ReviewBox p={c} F={F} locale={locale} />
            </div>
          );
        })}
      </section>

      {user ? (
        <form action={comment} className="card space-y-3">
          <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={thread.id} />
          <label className="label" htmlFor="cm">{F.yourComment}</label>
          <textarea id="cm" name="body" required minLength={5} maxLength={3000} rows={4} className="input" />
          <SubmitButton className="btn w-full">{F.sendComment}</SubmitButton>
        </form>
      ) : <Link className="btn" href={`/${locale}/login?next=/${locale}/forum/${thread.id}`}>{F.loginToPost}</Link>}
    </div>
  );
}
