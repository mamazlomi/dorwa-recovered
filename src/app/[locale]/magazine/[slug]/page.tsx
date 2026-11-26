import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { resolveLocale } from "@/i18n";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { isConfigured } from "@/lib/config";
import { pageMeta } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 300;
type Art = { slug: string; title: string; summary: string | null; body: string; author_name: string | null; reviewed_by: string | null; published_at: string };

async function load(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("magazine_articles").select("slug, title, summary, body, author_name, reviewed_by, published_at")
    .eq("slug", slug).eq("status", "published").maybeSingle();
  return data as Art | null;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const a = await load(slug);
  if (!a) return {};
  return pageMeta({ locale: locale as "fa" | "en" | "ar", path: `/magazine/${slug}`, title: a.title, description: a.summary ?? a.body.slice(0, 150) });
}

// Article text is plain text: blank lines split paragraphs, a line starting with "## " is a heading.
export default async function ArticlePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { slug } = await params;
  const a = await load(slug);
  if (!a) notFound();
  const C = getConsultTexts(locale);
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "long" });
  const blocks = a.body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <Link href={`/${locale}/magazine`} className="text-sm text-brand-700 underline">{C.magTitle}</Link>
      <h1 className="text-2xl font-extrabold leading-9">{a.title}</h1>
      <div className="text-xs text-muted">
        {df.format(new Date(a.published_at))}
        {a.author_name && ` · ${C.by}: ${a.author_name}`}
        {a.reviewed_by && ` · ${C.reviewedBy}: ${a.reviewed_by}`}
      </div>
      {blocks.map((b, i) => b.startsWith("## ")
        ? <h2 key={i} className="pt-2 text-lg font-bold">{b.slice(3)}</h2>
        : <p key={i} className="whitespace-pre-line leading-8">{b}</p>)}
      <p className="border-t border-line pt-3 text-xs text-muted">{C.disclaimer}</p>
    </article>
  );
}
