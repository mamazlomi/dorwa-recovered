import { pageMeta } from "@/lib/seo";
import { resolveLocale } from "@/i18n";
import { getAboutTexts } from "@/i18n/dictionaries/about";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return pageMeta({ locale, path: "/about", title: getAboutTexts(locale).title });
}

// How Dorva works; the home "why Dorva" band links to each section.
export default async function About({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  const A = getAboutTexts(locale);
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-extrabold">{A.title}</h1>
        <p className="text-muted leading-7">{A.intro}</p>
      </header>
      <nav className="flex flex-wrap gap-2">
        {A.sections.map((s) => <a key={s.id} href={`#${s.id}`} className="chip hover:bg-brand-50">{s.title}</a>)}
      </nav>
      {A.sections.map((s) => (
        <section key={s.id} id={s.id} className="card scroll-mt-28 space-y-2">
          <h2 className="text-xl font-bold text-accent-600">{s.title}</h2>
          {s.body.map((p, i) => <p key={i} className="leading-7">{p}</p>)}
        </section>
      ))}
    </article>
  );
}
