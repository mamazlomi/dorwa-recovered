import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, resolveLocale } from "@/i18n";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Expert = { user_id: string; display_name: string; specialty: string; license_no: string | null; bio: string | null; status: string };
type Ans = { id: string; question_id: string; body: string; verified: boolean; status: string; created_at: string };
type Art = { id: string; slug: string; title: string; summary: string | null; body: string; author_name: string | null; reviewed_by: string | null; status: string };

const loc = (fd: FormData) => { const r = String(fd.get("locale") ?? "fa"); return isLocale(r) ? r : "fa"; };
const done = (locale: string, r: string, anchor: string) => { revalidatePath("/", "layout"); redirect(`/${locale}/admin/consult?r=${r}#${anchor}`); };

async function setExpert(fd: FormData) {
  "use server";
  const { error } = await (await createClient()).from("consult_experts").update({ status: String(fd.get("status")) }).eq("user_id", String(fd.get("id")));
  done(loc(fd), error ? "forbidden" : "ok", "experts");
}
async function setAnswer(fd: FormData) {
  "use server";
  const patch = fd.get("op") === "hide" ? { status: "hidden" } : fd.get("op") === "show" ? { status: "visible" }
    : { verified: fd.get("op") === "verify" };
  const { error } = await (await createClient()).from("consult_answers").update(patch).eq("id", String(fd.get("id")));
  done(loc(fd), error ? "forbidden" : "ok", "answers");
}
async function saveArticle(fd: FormData) {
  "use server";
  const row = {
    slug: String(fd.get("slug") ?? "").trim().toLowerCase(), title: String(fd.get("title") ?? "").trim(),
    summary: String(fd.get("summary") ?? "").trim() || null, body: String(fd.get("body") ?? "").trim(),
    author_name: String(fd.get("author") ?? "").trim() || null, reviewed_by: String(fd.get("reviewer") ?? "").trim() || null,
    status: fd.get("publish") === "on" ? "published" : "draft",
  };
  const { error } = await (await createClient()).from("magazine_articles").upsert(row, { onConflict: "slug" });
  done(loc(fd), error ? "invalid" : "ok", "articles");
}

export default async function AdminConsultPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string; edit?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user, supabase } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/consult`);
  const C = getConsultTexts(locale), A = C.admin;
  const sp = await searchParams;

  const { data: perms } = await supabase.rpc("my_platform_permissions");
  if (!((perms as string[] | null) ?? []).includes("consult.manage")) {
    return <div className="space-y-4"><AdminTabs locale={locale} current="dashboard" labels={getRules(locale)} /><ErrorBox message={A.forbidden} /></div>;
  }
  const [{ data: ex }, { data: an }, { data: ar }] = await Promise.all([
    supabase.from("consult_experts").select("user_id, display_name, specialty, license_no, bio, status").order("created_at", { ascending: false }).limit(100),
    supabase.from("consult_answers").select("id, question_id, body, verified, status, created_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("magazine_articles").select("id, slug, title, summary, body, author_name, reviewed_by, status").order("created_at", { ascending: false }).limit(50),
  ]);
  const experts = (ex as Expert[] | null) ?? [], answers = (an as Ans[] | null) ?? [], arts = (ar as Art[] | null) ?? [];
  const editing = arts.find((a) => a.slug === sp.edit);

  const hidden = (id: string, key = "id") => (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name={key} value={id} /></>);
  return (
    <div className="space-y-8">
      <AdminTabs locale={locale} current="consult" labels={getRules(locale)} />
      {sp.r === "forbidden" && <ErrorBox message={A.forbidden} />}
      {sp.r === "invalid" && <ErrorBox message={C.failed} />}

      <section id="experts" className="space-y-3">
        <h2 className="text-lg font-bold">{A.experts}</h2>
        {experts.length === 0 && <p className="text-muted">{A.noExperts}</p>}
        {experts.map((e) => (
          <div key={e.user_id} className="card flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <b>{e.display_name}</b> <span className="text-sm text-muted">{C.specialties[e.specialty] ?? e.specialty}</span>
              {e.license_no && <span className="ms-2 text-xs" dir="ltr">{e.license_no}</span>}
              {e.bio && <p className="text-sm text-muted">{e.bio}</p>}
            </div>
            <span className="text-xs">{C.status[e.status]}</span>
            <form action={setExpert} className="flex gap-2">
              {hidden(e.user_id)}
              {e.status !== "approved" && <SubmitButton name="status" value="approved" className="btn">{A.approve}</SubmitButton>}
              {e.status !== "suspended" && <SubmitButton name="status" value="suspended" className="btn-ghost">{A.suspend}</SubmitButton>}
            </form>
          </div>
        ))}
      </section>

      <section id="answers" className="space-y-3">
        <h2 className="text-lg font-bold">{A.answers}</h2>
        {answers.length === 0 && <p className="text-muted">{A.noAnswers}</p>}
        {answers.map((a) => (
          <div key={a.id} className="card space-y-2">
            <p className="line-clamp-4 whitespace-pre-line text-sm leading-7">{a.body}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="text-xs text-brand-700 underline" href={`/${locale}/forum/${a.question_id}`}>#</Link>
              {a.verified && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">✓ {C.verified}</span>}
              {a.status === "hidden" && <span className="text-xs text-red-700">{A.hide}</span>}
              <form action={setAnswer} className="ms-auto flex gap-2">
                {hidden(a.id)}
                <SubmitButton name="op" value={a.verified ? "unverify" : "verify"} className="btn-ghost">{a.verified ? A.unverify : A.verify}</SubmitButton>
                <SubmitButton name="op" value={a.status === "hidden" ? "show" : "hide"} className="btn-ghost">{a.status === "hidden" ? A.show : A.hide}</SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </section>

      <section id="articles" className="space-y-3">
        <h2 className="text-lg font-bold">{A.articles}</h2>
        <ul className="space-y-1 text-sm">
          {arts.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === "published" ? "bg-green-100 text-green-800" : "bg-gray-100"}`}>{a.status === "published" ? A.published : A.draft}</span>
              <span className="flex-1">{a.title}</span>
              <Link className="text-brand-700 underline" href={`/${locale}/admin/consult?edit=${a.slug}#form`}>{A.edit}</Link>
            </li>
          ))}
        </ul>
        <form id="form" action={saveArticle} className="card space-y-3" key={editing?.slug ?? "new"}>
          <input type="hidden" name="locale" value={locale} />
          <h3 className="font-bold">{editing ? editing.title : A.newArticle}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">{A.slug}</label><input name="slug" required dir="ltr" pattern="[a-z0-9][a-z0-9\-]{1,78}[a-z0-9]" defaultValue={editing?.slug ?? ""} readOnly={Boolean(editing)} className="input" /></div>
            <div><label className="label">{C.titleLabel}</label><input name="title" required minLength={5} maxLength={160} defaultValue={editing?.title ?? ""} className="input" /></div>
            <div><label className="label">{A.author}</label><input name="author" defaultValue={editing?.author_name ?? ""} className="input" /></div>
            <div><label className="label">{A.reviewer}</label><input name="reviewer" defaultValue={editing?.reviewed_by ?? ""} className="input" /></div>
          </div>
          <div><label className="label">{A.summary}</label><textarea name="summary" maxLength={400} rows={2} defaultValue={editing?.summary ?? ""} className="input" /></div>
          <div><label className="label">{A.body}</label><textarea name="body" required minLength={50} rows={12} defaultValue={editing?.body ?? ""} className="input" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="publish" defaultChecked={editing?.status === "published"} /> {A.publish}</label>
          <SubmitButton className="btn">{A.saveArticle}</SubmitButton>
        </form>
      </section>
    </div>
  );
}
