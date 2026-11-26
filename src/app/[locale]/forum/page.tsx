import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getForumTexts } from "@/i18n/dictionaries/forum";
import { isConfigured } from "@/lib/config";
import { pageMeta } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Th = { id: string; title: string; body: string; category: string; review_state: string; created_at: string };
const CATS = ["general", "drug", "pregnancy", "child", "skin", "supplement", "elderly", "nutrition", "mental", "other"];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  const F = getForumTexts(locale);
  return pageMeta({ locale, path: "/forum", title: F.title, description: F.intro });
}

async function newThread(fd: FormData) {
  "use server";
  const raw = String(fd.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/forum`);
  const category = CATS.includes(String(fd.get("category"))) ? String(fd.get("category")) : "general";
  const { data, error } = await supabase.from("forum_posts").insert({
    title: String(fd.get("title") ?? "").trim().slice(0, 140),
    body: String(fd.get("body") ?? "").trim().slice(0, 3000), category,
  }).select("id").single();
  if (error || !data) redirect(`/${locale}/forum?e=${error?.code === "P0001" ? "limit" : "failed"}`);
  redirect(`/${locale}/forum/${data.id}`);
}

export default async function ForumPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ cat?: string; e?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const F = getForumTexts(locale);
  const sp = await searchParams;
  const cat = CATS.includes(sp.cat ?? "") ? sp.cat! : "";
  const { supabase, user } = await getUser();

  let canReview = false;
  if (user) {
    const [{ data: perms }, { data: me }] = await Promise.all([
      supabase.rpc("my_platform_permissions"),
      supabase.from("consult_experts").select("status").eq("user_id", user.id).eq("status", "approved").maybeSingle(),
    ]);
    canReview = Boolean(me) || ((perms as string[] | null) ?? []).includes("consult.manage");
  }
  let q = supabase.from("forum_posts").select("id, title, body, category, review_state, created_at")
    .is("parent_id", null).eq("status", "visible").order("created_at", { ascending: false }).limit(40);
  if (cat) q = q.eq("category", cat);
  const { data } = await q;
  const list = (data as Th[] | null) ?? [];
  const { data: cc } = list.length ? await supabase.rpc("forum_comment_counts", { p_ids: list.map((x) => x.id) }) : { data: [] };
  const cnt = new Map(((cc as { thread_id: string; comments: number; reviewed: number }[] | null) ?? []).map((c) => [c.thread_id, c]));
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="card bg-gradient-to-l from-brand-50 to-white">
        <h1 className="mb-2 text-2xl font-extrabold">{F.title}</h1>
        <p className="text-sm leading-7 text-muted">{F.intro}</p>
        <p className="mt-2 text-xs text-muted">{F.disclaimer}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link className="text-brand-700 underline" href={`/${locale}/consult`}>{F.consultLink}</Link>
          {canReview && <Link className="text-brand-700 underline" href={`/${locale}/forum/review`}>{F.admin.queue}</Link>}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold">{F.newThread}</h2>
        {sp.e && <ErrorBox message={sp.e === "limit" ? F.limit : F.failed} />}
        {user ? (
          <form action={newThread} className="space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <div><label className="label" htmlFor="f-title">{F.threadTitle}</label>
              <input id="f-title" name="title" required minLength={5} maxLength={140} className="input" /></div>
            <div><label className="label" htmlFor="f-body">{F.threadBody}</label>
              <textarea id="f-body" name="body" required minLength={5} maxLength={3000} rows={4} className="input" /></div>
            <div><label className="label" htmlFor="f-cat">{F.category}</label>
              <select id="f-cat" name="category" className="input">{CATS.map((k) => <option key={k} value={k}>{F.categories[k]}</option>)}</select></div>
            <SubmitButton className="btn w-full">{F.post}</SubmitButton>
          </form>
        ) : <Link className="btn" href={`/${locale}/login?next=/${locale}/forum`}>{F.loginToPost}</Link>}
      </section>

      <form method="get" className="flex gap-2">
        <select name="cat" defaultValue={cat} aria-label={F.category} className="input">
          <option value="">{F.all}</option>{CATS.map((k) => <option key={k} value={k}>{F.categories[k]}</option>)}
        </select>
        <button className="btn-ghost">{F.filter}</button>
      </form>

      {list.length === 0 ? <p className="card text-center text-muted">{F.empty}</p> : (
        <ul className="space-y-2">
          {list.map((x) => {
            const c = cnt.get(x.id);
            const badge = F.review[x.review_state];
            return (
              <li key={x.id}>
                <Link href={`/${locale}/forum/${x.id}`} className="card block hover:bg-brand-50">
                  <div className="font-bold">{x.title}</div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{x.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{F.categories[x.category] ?? x.category}</span><span>·</span><span>{df.format(new Date(x.created_at))}</span><span>·</span>
                    <span>{formatNumber(c?.comments ?? 0, locale)} {F.comments}</span>
                    {badge && x.review_state !== "pending" && <span className="rounded-full bg-green-100 px-2 py-0.5 font-bold text-green-800">✓ {badge}</span>}
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
