import { StaffAccessNote } from "@/components/StaffAccessNote";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PharmacyLookEditor } from "@/components/PharmacyLookEditor";
import { SetupNotice } from "@/components/SetupNotice";
import { localized, resolveLocale } from "@/i18n";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getStudioTexts(locale).lookTitle, robots: { index: false } };
}

type Ed = { draft: Record<string, string>; published: Record<string, string> | null; status: string; review_note: string | null; needs_approval: boolean };

// A pharmacy's own accent color, logo and cover; goes live after Dorva approves (setting).
export default async function PharmacyLook({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const S = getStudioTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/look`);
  const supabase = await createClient();
  const sp = await searchParams;
  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phId = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!phId) redirect(`/${locale}/pharmacy/dashboard`);
  const [{ data: phData }, { data: edData, error }] = await Promise.all([
    supabase.from("pharmacies").select("id, slug, name_fa, name_i18n").eq("id", phId).maybeSingle(),
    supabase.rpc("pharmacy_look_editor", { p_pharmacy: phId }),
  ]);
  const ph = phData as { id: string; slug: string; name_fa: string; name_i18n: Record<string, string> } | null;
  if (!ph) redirect(`/${locale}/pharmacy/dashboard`);
  // switched off by Dorva, or no page permission
  if (error || !edData || (edData as { can_edit?: boolean }).can_edit === false) return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{S.lookTitle}</h1><p className="text-sm">{S.disabled}</p></div>;
  const ed = edData as Ed;

  return (
    <div className="max-w-3xl space-y-5">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${ph.id}`} className="text-sm text-brand-700 hover:underline">{localized(ph.name_fa, ph.name_i18n, locale)}</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{S.lookTitle}</h1>
        <StaffAccessNote pharmacy={phId} locale={locale} />
        <span className="chip">{S.lookStatus[ed.status] ?? ed.status}</span>
      </div>
      <p className="text-sm text-muted">{S.lookIntro}</p>
      {ed.review_note && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{S.note}: {ed.review_note}</p>}
      <PharmacyLookEditor pharmacy={ph.id} name={localized(ph.name_fa, ph.name_i18n, locale)} initial={ed.draft ?? {}}
        needsApproval={ed.needs_approval} previewHref={`/${locale}/${ph.slug}?preview=1`} texts={S} />
    </div>
  );
}
