import { StaffAccessNote } from "@/components/StaffAccessNote";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageBuilder } from "@/components/PageBuilder";
import { SetupNotice } from "@/components/SetupNotice";
import { localized, resolveLocale } from "@/i18n";
import { getPageTexts } from "@/i18n/dictionaries/pages";
import { loadBuilder } from "@/lib/builderData";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getPageTexts(locale).pharmacyTitle, robots: { index: false } };
}

// A pharmacy arranges its own page; changes go live after Dorva approves (setting).
export default async function PharmacyPageBuilder({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const P = getPageTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/page`);
  const supabase = await createClient();
  const sp = await searchParams;
  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phId = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!phId) redirect(`/${locale}/pharmacy/dashboard`);
  const [{ data: phData }, b] = await Promise.all([
    supabase.from("pharmacies").select("id, slug, name_fa, name_i18n").eq("id", phId).maybeSingle(),
    loadBuilder(supabase, phId, locale),
  ]);
  const ph = phData as { id: string; slug: string; name_fa: string; name_i18n: Record<string, string> } | null;
  if (!ph) redirect(`/${locale}/pharmacy/dashboard`);
  if (!b) return <div className="card max-w-xl"><p className="text-sm">{P.disabled}</p></div>;

  return (
    <div className="space-y-5">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${ph.id}`} className="text-sm text-brand-700 hover:underline">{localized(ph.name_fa, ph.name_i18n, locale)}</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{P.pharmacyTitle}</h1>
        <StaffAccessNote pharmacy={phId} locale={locale} />
        <span className="chip">{P.status[b.ed.status] ?? b.ed.status}</span>
      </div>
      <p className="text-sm text-muted">{P.intro}</p>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{P.rxRule}</p>
      {b.ed.published_at && <p className="text-xs text-muted">{P.liveNote}</p>}
      {b.ed.review_note && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{P.reviewNote}: {b.ed.review_note}</p>}
      <PageBuilder pharmacy={ph.id} initial={b.ed.draft} allowed={b.ed.allowed} maxBlocks={b.ed.max_blocks} maxSlides={b.ed.max_slides}
        needsApproval={b.ed.needs_approval} collections={b.collections} productNames={b.productNames}
        previewHref={`/${locale}/${ph.slug}?preview=1`} texts={P} />
    </div>
  );
}
