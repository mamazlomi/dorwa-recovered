import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, resolveLocale } from "@/i18n";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function createHolding(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name.length < 2) redirect(`/${locale}/holding?r=unknown`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("holding_create", { p_name: name });
  if (error || typeof data !== "string") redirect(`/${locale}/holding?r=${error?.message.includes("limit") ? "limit" : "unknown"}`);
  redirect(`/${locale}/holding/${data}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getStaffTexts(locale).holdingsTitle, robots: { index: false } };
}

export default async function HoldingsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const s = getStaffTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/holding`);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("holding_members").select("role, holdings(id, name, status)").eq("user_id", user.id);
  const rows = ((data as unknown as { role: string; holdings: { id: string; name: string; status: string } | null }[]) ?? []).filter((r) => r.holdings);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/${locale}/account`} className="text-sm text-brand-700 hover:underline">{t.nav.account}</Link>
      <h1 className="text-2xl font-extrabold">{s.holdingsTitle}</h1>
      <p className="text-sm text-muted">{s.holdingIntro}</p>
      {sp.r && <ErrorBox message={s.requestResult[sp.r] ?? s.results.unknown} />}
      {rows.length === 0 ? <p className="card text-sm text-muted">{s.noHoldings}</p> : (
        <ul className="card divide-y divide-line p-0">
          {rows.map((r) => (
            <li key={r.holdings!.id} className="flex items-center justify-between gap-2 p-4 text-sm">
              <span className="font-semibold">{r.holdings!.name}</span>
              <Link href={`/${locale}/holding/${r.holdings!.id}`} className="btn-ghost py-1.5 text-xs">{s.open}</Link>
            </li>
          ))}
        </ul>
      )}
      <form action={createHolding} className="card flex flex-wrap items-end gap-2">
        <input type="hidden" name="locale" value={locale} />
        <label className="min-w-0 flex-1"><span className="label">{s.holdingName}</span>
          <input name="name" required minLength={2} maxLength={80} className="input" /></label>
        <SubmitButton className="btn">{s.newHolding}</SubmitButton>
      </form>
    </div>
  );
}
