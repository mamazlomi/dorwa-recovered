import { StaffAccessNote } from "@/components/StaffAccessNote";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileEditor, type ProfileData } from "@/components/ProfileEditor";
import { SetupNotice } from "@/components/SetupNotice";
import { localized, resolveLocale } from "@/i18n";
import { getAddressTexts } from "@/i18n/dictionaries/address";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { getRound6Texts } from "@/i18n/dictionaries/round6";
import { aiEnabled } from "@/lib/ai";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { loadMapSettings } from "@/lib/mapSettings";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Named = { code: string; name_fa: string; name_i18n: Record<string, string> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getProfileTexts(locale).title, robots: { index: false } };
}

// A pharmacy's profile: contact, map, founder and pharmacists, type, insurers, hours, about text.
export default async function PharmacyProfile({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const P = getProfileTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/profile`);
  const supabase = await createClient();
  const sp = await searchParams;
  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phId = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!phId) redirect(`/${locale}/pharmacy/dashboard`);
  const [{ data, error }, { data: kindData }, { data: insData }, map, { data: grpData }, { data: srvData }] = await Promise.all([
    supabase.rpc("pharmacy_profile_get", { p_pharmacy: phId }),
    supabase.from("pharmacy_kinds").select("code, name_fa, name_i18n").eq("active", true).order("sort"),
    supabase.from("insurers").select("code, name_fa, name_i18n").eq("active", true).order("sort"),
    loadMapSettings(supabase),
    supabase.from("pharmacy_service_groups").select("code, name_fa, name_i18n").eq("active", true).order("sort"),
    supabase.from("pharmacy_service_options").select("code, group_code, name_fa, name_i18n").eq("active", true).order("sort"),
  ]);
  if (error || !data) return <div className="card max-w-xl"><p className="text-sm">{P.result.forbidden}</p></div>;
  const prof = data as ProfileData & { name_fa: string; name_i18n: Record<string, string> };
  const a = getAddressTexts(locale);
  const srv = (srvData as (Named & { group_code: string })[] | null) ?? [];
  const groups = ((grpData as Named[] | null) ?? []).map((g) => ({
    code: g.code, name: localized(g.name_fa, g.name_i18n, locale),
    items: srv.filter((x) => x.group_code === g.code).map((x) => ({ code: x.code, name: localized(x.name_fa, x.name_i18n, locale) })),
  })).filter((g) => g.items.length > 0);
  const opts = (rows: unknown) => ((rows as Named[]) ?? []).map((x) => ({ code: x.code, name: localized(x.name_fa, x.name_i18n, locale) }));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${phId}`} className="text-sm text-brand-700 hover:underline">{localized(prof.name_fa, prof.name_i18n, locale)}</Link>
      <h1 className="text-2xl font-extrabold">{P.title}</h1>
      <StaffAccessNote pharmacy={phId} locale={locale} />
      <p className="text-sm text-muted">{P.intro}</p>
      <ProfileEditor initial={prof} kinds={opts(kindData)} insurers={opts(insData)} groups={groups} map={map} locale={locale} texts={P}
        r5={getRound5Texts(locale)} r6={getRound6Texts(locale)} aiOn={aiEnabled()}
        mapLabels={{ search: a.search, searchBtn: a.searchBtn, noResults: a.noResults, searchError: a.searchError,
          myLocation: a.myLocation, locating: a.locating, denied: a.denied, mapHelp: a.mapHelp,
          addressLine: a.addressLine, addressHint: a.addressHint, mapLoading: a.mapLoading }} />
    </div>
  );
}
