import Link from "next/link";
import { redirect } from "next/navigation";
import { Scanner } from "@/components/Scanner";
import { SetupNotice } from "@/components/SetupNotice";
import { localized, resolveLocale } from "@/i18n";
import { getToolTexts } from "@/i18n/dictionaries/tools";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getToolTexts(locale).scan.title, robots: { index: false } };
}

// Pharmacy panel › scan barcodes and receive stock.
export default async function ScanPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/scan`);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phId = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!phId) redirect(`/${locale}/pharmacy/dashboard`);
  const [{ data: perms }, { data: ph }] = await Promise.all([
    supabase.rpc("my_pharmacy_permissions", { p_pharmacy: phId }),
    supabase.from("pharmacies").select("name_fa, name_i18n").eq("id", phId).maybeSingle(),
  ]);
  const can = new Set((perms as string[] | null) ?? []);
  const T = getToolTexts(locale).scan;
  if (!can.has("inventory.read") && !can.has("inventory.manage")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const p = ph as { name_fa: string; name_i18n: Record<string, string> } | null;
  return (
    <div className="space-y-4">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${phId}`} className="text-sm text-brand-700 hover:underline">‹ {p ? localized(p.name_fa, p.name_i18n, locale) : ""}</Link>
      <h1 className="text-2xl font-extrabold">{T.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{T.intro}</p>
      <Scanner pharmacyId={phId} texts={T as unknown as Record<string, string>} sources={T.sources} errors={T.errors} suggestErrors={T.suggestErr}
        canReceive={can.has("inventory.manage")} />
    </div>
  );
}
