import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardView, mergeLayout, type FinderStats, type Metrics } from "@/components/Dashboard";
import { SetupNotice } from "@/components/SetupNotice";
import { localized, resolveLocale } from "@/i18n";
import { getDashboardTexts } from "@/i18n/dictionaries/dashboard";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90, 365];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getDashboardTexts(locale).pharmacyTitle, robots: { index: false } };
}

export default async function PharmacyInsightsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string; days?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const D = getDashboardTexts(locale);
  const sp = await searchParams;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/insights`);
  const supabase = await createClient();
  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phId = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!phId) redirect(`/${locale}/pharmacy/dashboard`);
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;

  const [{ data: phData }, { data, error }, { data: lay }, { data: fin }] = await Promise.all([
    supabase.from("pharmacies").select("id, name_fa, name_i18n").eq("id", phId).maybeSingle(),
    supabase.rpc("dash_metrics", { p_pharmacy: phId, p_days: days }),
    supabase.from("dashboard_layouts").select("widgets").eq("user_id", user.id).eq("scope", phId).maybeSingle(),
    supabase.rpc("finder_stats", { p_pharmacy: phId, p_days: days }),
  ]);
  const ph = phData as { id: string; name_fa: string; name_i18n: Record<string, string> } | null;
  if (!ph || error || !data) return <div className="card max-w-xl"><p className="text-sm">{D.forbidden}</p></div>;

  return (
    <div className="space-y-2">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${ph.id}`} className="text-sm text-brand-700 hover:underline">
        {localized(ph.name_fa, ph.name_i18n, locale)}
      </Link>
      <h1 className="mb-2 text-2xl font-extrabold">{D.pharmacyTitle}</h1>
      <DashboardView locale={locale} m={data as Metrics} scope={ph.id} platform={false}
        layout={mergeLayout((lay as { widgets: unknown } | null)?.widgets, false)}
        periodHref={(d) => `/${locale}/pharmacy/insights?ph=${ph.id}&days=${d}`} finder={fin as FinderStats | null} />
    </div>
  );
}
