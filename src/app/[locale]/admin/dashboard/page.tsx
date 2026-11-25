import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { InboxReminder } from "@/components/InboxReminder";
import { DashboardView, mergeLayout, type FinderStats, type Metrics } from "@/components/Dashboard";
import { SetupNotice } from "@/components/SetupNotice";
import { resolveLocale } from "@/i18n";
import { getDashboardTexts } from "@/i18n/dictionaries/dashboard";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90, 365];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getDashboardTexts(locale).title, robots: { index: false } };
}

export default async function AdminDashboardPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ days?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const D = getDashboardTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/dashboard`);
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  if (!((perms as string[] | null) ?? []).includes("pharmacy.read_all")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [{ data, error }, { data: fin }, { data: lay }] = await Promise.all([
    supabase.rpc("dash_metrics", { p_pharmacy: null, p_days: days }),
    supabase.rpc("finder_stats", { p_pharmacy: null, p_days: days }),
    supabase.from("dashboard_layouts").select("widgets").eq("user_id", user.id).eq("scope", "platform").maybeSingle(),
  ]);
  return (
    <div>
      <AdminTabs locale={locale} current="dashboard" labels={getRules(locale)} />
      <InboxReminder locale={locale} />
      <h1 className="mb-4 text-2xl font-extrabold">{D.title}</h1>
      {error || !data ? <p className="card text-sm">{D.forbidden}</p> : (
        <DashboardView locale={locale} m={data as Metrics} scope="platform" platform
          layout={mergeLayout((lay as { widgets: unknown } | null)?.widgets, true)}
          periodHref={(d) => `/${locale}/admin/dashboard?days=${d}`} finder={fin as FinderStats | null} />
      )}
    </div>
  );
}
