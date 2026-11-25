import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { getTeamTexts } from "@/i18n/dictionaries/team";
import { StaffPanel, type Perm, type RoleTemplate, type StaffInvite, type StaffMember } from "@/components/StaffPanel";
import { SubmitButton } from "@/components/SubmitButton";
import { localized, resolveLocale } from "@/i18n";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { decideHoldingLink } from "@/lib/staffActions";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Link_ = { id: string; holding_name: string; status: string; message: string | null; created_at: string };
const OK = new Set(["ok", "done", "accepted", "declined"]);

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getStaffTexts(locale).pharmacyStaffTitle, robots: { index: false } };
}

export default async function PharmacyStaffPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string; r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const s = getStaffTexts(locale);
  const sp = await searchParams;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/staff`);
  const supabase = await createClient();
  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const ph = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!ph) redirect(`/${locale}/pharmacy/dashboard`);

  const [{ data: phData }, { data: membersData }, { data: rolesData }, { data: invData }, { data: linkData }] = await Promise.all([
    supabase.from("pharmacies").select("id, name_fa, name_i18n").eq("id", ph).maybeSingle(),
    supabase.rpc("staff_list", { p_pharmacy: ph }),
    supabase.rpc("role_templates", { p_scope: "pharmacy", p_pharmacy: ph }),
    supabase.from("staff_invites").select("id, email, role_id, created_at, expires_at").eq("pharmacy_id", ph).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.rpc("pharmacy_holding_links", { p_pharmacy: ph }),
  ]);
  const { data: catData } = await supabase.rpc("permission_catalog", { p_scope: "pharmacy", p_pharmacy: ph });
  const T = getTeamTexts(locale);
  const pharmacy = phData as { id: string; name_fa: string; name_i18n: I18n } | null;
  const members = (membersData as StaffMember[]) ?? [];
  if (!pharmacy || members.length === 0) return <div className="card max-w-xl"><p className="text-sm">{s.results.forbidden}</p></div>;
  const links = (linkData as Link_[]) ?? [];
  const back = `/${locale}/pharmacy/staff?ph=${ph}`;
  const msg = sp.r ? (sp.r.startsWith("access_") ? (T.results[sp.r.slice(7)] ?? s.results.unknown) : (s.results[sp.r] ?? s.inviteResult[sp.r] ?? s.results.unknown)) : null;
  const hidden = (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="back" value={back} /></>);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${ph}`} className="text-sm text-brand-700 hover:underline">{localized(pharmacy.name_fa, pharmacy.name_i18n, locale)}</Link>
      <h1 className="text-2xl font-extrabold">{s.pharmacyStaffTitle}</h1>
      <p className="text-sm text-muted">{s.intro}</p>
      {msg && (OK.has(sp.r!) || sp.r === "access_ok" ? <OkBox message={msg} /> : <ErrorBox message={msg} />)}
      <StaffPanel locale={locale} pharmacyId={ph} back={back} members={members}
        invites={(invData as StaffInvite[]) ?? []} roles={(rolesData as RoleTemplate[]) ?? []} perms={(catData as Perm[]) ?? []} />

      <section className="card space-y-2">
        <h2 className="font-bold">{s.holdingRequests}</h2>
        <p className="text-xs text-muted">{s.holdingRequestsIntro}</p>
        {links.length === 0 ? <p className="text-sm text-muted">{s.noRequests}</p> : (
          <ul className="divide-y divide-line text-sm">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{l.holding_name} <span className="chip ms-1">{s.linkStatus[l.status] ?? l.status}</span></p>
                  {l.message && <p className="text-xs text-muted">{l.message}</p>}
                </div>
                <div className="flex gap-2">
                  {l.status === "requested" && (
                    <>
                      <form action={decideHoldingLink}>{hidden}<input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="act" value="approve" />
                        <SubmitButton className="btn py-1 text-xs">{s.approve}</SubmitButton></form>
                      <form action={decideHoldingLink}>{hidden}<input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="act" value="reject" />
                        <SubmitButton className="btn-ghost py-1 text-xs">{s.reject}</SubmitButton></form>
                    </>
                  )}
                  {l.status === "active" && (
                    <form action={decideHoldingLink}>{hidden}<input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="act" value="revoke" />
                      <SubmitButton className="btn-ghost py-1 text-xs text-red-700">{s.cut}</SubmitButton></form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
