import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { PageBuilder } from "@/components/PageBuilder";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, localized, resolveLocale } from "@/i18n";
import { getPageTexts } from "@/i18n/dictionaries/pages";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { getRules } from "@/i18n/dictionaries/rules";
import { loadBuilder } from "@/lib/builderData";
import { isConfigured } from "@/lib/config";
import { reviewPage } from "@/lib/pageActions";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Q = { pharmacy_id: string; slug: string; name_fa: string; name_i18n: Record<string, string>; status: string;
  submitted_at: string | null; published_at: string | null; blocks: number; review_note: string | null };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getPageTexts(locale).homeTitle, robots: { index: false } };
}

// Dorva: arrange the home page; review the pages pharmacies send in.
export default async function AdminPages({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const P = getPageTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/pages`);
  const supabase = await createClient();
  const [b, { data: qData }] = await Promise.all([loadBuilder(supabase, null, locale), supabase.rpc("page_queue")]);
  const sp = await searchParams;
  if (!b) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const queue = (qData as Q[]) ?? [];
  const when = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : locale === "ar" ? "ar" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="pages" labels={getRules(locale)} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{P.homeTitle}</h1>
        <div className="flex gap-3 text-sm">
          <Link href={`/${locale}`} className="text-brand-700 hover:underline" target="_blank">{P.preview} ↗</Link>
          <Link href={`/${locale}/admin/theme`} className="text-brand-700 hover:underline">{getStudioTexts(locale).title}</Link>
        </div>
      </div>
      <p className="text-sm text-muted">{P.intro}</p>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{P.rxRule}</p>
      {sp.r && <p role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{P.result[sp.r] ?? P.result.unknown}</p>}

      <PageBuilder pharmacy={null} initial={b.ed.draft} allowed={b.ed.allowed} maxBlocks={b.ed.max_blocks} maxSlides={b.ed.max_slides}
        needsApproval={false} collections={b.collections} productNames={b.productNames}
        previewHref={`/${locale}?preview=1`} texts={P} />

      <section className="card space-y-3">
        <h2 className="text-lg font-bold">{P.queueTitle}</h2>
        {queue.length === 0 ? <p className="text-sm text-muted">{P.queueEmpty}</p> : (
          <ul className="divide-y divide-line">
            {queue.map((q) => (
              <li key={q.pharmacy_id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/${locale}/${q.slug}?preview=1`} target="_blank" className="font-semibold hover:underline">
                    {localized(q.name_fa, q.name_i18n, locale)} ↗
                  </Link>
                  <span className="text-xs text-muted">
                    {P.status[q.status] ?? q.status} · {P.blocks.replace("{n}", formatNumber(q.blocks, locale))}
                    {q.submitted_at && ` · ${P.submitted.replace("{t}", when.format(new Date(q.submitted_at)))}`}
                  </span>
                </div>
                {q.review_note && <p className="text-xs text-muted">{P.reviewNote}: {q.review_note}</p>}
                <form action={reviewPage} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="pharmacy_id" value={q.pharmacy_id} />
                  <input name="note" maxLength={500} placeholder={P.notePh} className="input min-w-0 flex-1" />
                  {q.status === "pending" && <SubmitButton name="act" value="approve" className="btn text-sm" pendingLabel="…">{P.approve}</SubmitButton>}
                  {q.status === "pending" && <SubmitButton name="act" value="reject" className="btn-ghost text-sm" pendingLabel="…">{P.reject}</SubmitButton>}
                  {q.published_at && <SubmitButton name="act" value="unpublish" className="btn-ghost text-sm text-red-700" pendingLabel="…">{P.unpublish}</SubmitButton>}
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
