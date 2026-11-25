import Link from "next/link";
import { redirect } from "next/navigation";
import { OfficerSelfEditor, type Officer } from "@/components/ProfileEditor";
import { SetupNotice } from "@/components/SetupNotice";
import { localized, resolveLocale } from "@/i18n";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { getRound6Texts } from "@/i18n/dictionaries/round6";
import { aiEnabled } from "@/lib/ai";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Me = {
  officer: Officer;
  pharmacies: { id: string; slug: string; name_fa: string; name_i18n: Record<string, string>; status: string }[];
  mode: string;
  change: { payload: Officer; status: "pending" | "rejected"; note: string | null; submitted_at: string } | null;
} | null;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getRound6Texts(locale).me.title, robots: { index: false } };
}

// A technical officer edits their own professional profile (shown on every pharmacy they work for).
export default async function MyPharmacistProfile({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/account/pharmacist`);
  const M = getRound6Texts(locale).me;
  const R = getRound6Texts(locale).profile;
  const { data } = await (await createClient()).rpc("my_officer_profile");
  const me = data as Me;
  if (!me) {
    return (
      <div className="card mx-auto max-w-xl space-y-2">
        <h1 className="text-xl font-bold">{M.title}</h1>
        <p className="text-sm text-muted">{M.notLinked}</p>
        <Link href={`/${locale}/account`} className="text-sm text-brand-700 hover:underline">{t.account.title}</Link>
      </div>
    );
  }
  const base = me.change?.payload ? { ...me.officer, ...me.change.payload } : me.officer;
  const initial: Officer = { ...base, shifts: [] };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/${locale}/account`} className="text-sm text-brand-700 hover:underline">{t.account.title}</Link>
      <h1 className="text-2xl font-extrabold">{M.title}</h1>
      <p className="text-sm text-muted">{M.intro}</p>
      <p className="text-sm">{M.pharmacies}{" "}
        {me.pharmacies.map((p, i) => (
          <span key={p.id}>{i > 0 ? "، " : ""}<Link href={`/${locale}/${p.slug}?tab=about`} className="text-brand-700 hover:underline">{localized(p.name_fa, p.name_i18n, locale)}</Link></span>
        ))}
      </p>
      {me.mode === "locked" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{M.results.locked}</p>}
      {me.change?.status === "pending" && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{R.pendingBanner.replace("{t}", new Date(me.change.submitted_at).toLocaleString(locale === "fa" ? "fa-IR" : locale))}</p>
      )}
      {me.change?.status === "rejected" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{R.rejectedBanner.replace("{n}", me.change.note ?? "—")}</p>}
      <OfficerSelfEditor initial={initial} me={user.id} folder={me.pharmacies[0].id} P={getProfileTexts(locale)} r5={getRound5Texts(locale)}
        r6={getRound6Texts(locale)} aiOn={aiEnabled()} />
    </div>
  );
}
