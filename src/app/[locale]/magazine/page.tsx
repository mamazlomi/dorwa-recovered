import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { resolveLocale } from "@/i18n";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { isConfigured } from "@/lib/config";
import { pageMeta } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 300;
type Art = { slug: string; title: string; summary: string | null; author_name: string | null; published_at: string };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  const C = getConsultTexts(locale);
  return pageMeta({ locale, path: "/magazine", title: C.magTitle, description: C.magIntro });
}

export default async function MagazinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const C = getConsultTexts(locale);
  const supabase = await createClient();
  const { data } = await supabase.from("magazine_articles").select("slug, title, summary, author_name, published_at")
    .eq("status", "published").order("published_at", { ascending: false }).limit(60);
  const list = (data as Art[] | null) ?? [];
  const df = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium" });
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="card bg-gradient-to-l from-brand-50 to-white">
        <h1 className="mb-2 text-2xl font-extrabold">{C.magTitle}</h1>
        <p className="text-sm text-muted">{C.magIntro}</p>
      </section>
      {list.length === 0 ? <p className="card text-center text-muted">{C.magEmpty}</p> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <li key={a.slug}>
              <Link href={`/${locale}/magazine/${a.slug}`} className="card block h-full hover:bg-brand-50">
                <div className="font-bold leading-7">{a.title}</div>
                {a.summary && <p className="mt-1 line-clamp-3 text-sm text-muted">{a.summary}</p>}
                <div className="mt-2 text-xs text-muted">{df.format(new Date(a.published_at))}{a.author_name ? ` · ${a.author_name}` : ""}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
