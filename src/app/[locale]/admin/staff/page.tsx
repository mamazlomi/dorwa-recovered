import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { getTeamTexts } from "@/i18n/dictionaries/team";
import { StaffPanel, type Perm, type RoleTemplate, type StaffInvite, type StaffMember } from "@/components/StaffPanel";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, resolveLocale } from "@/i18n";
import { getRules } from "@/i18n/dictionaries/rules";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Permission = { code: string; scope: string; description_fa: string };
const OK = new Set(["ok", "done", "accepted", "declined"]);
const LOCKED: Record<string, string> = { owner: "staff.manage", super_admin: "platform.roles.manage" };

const localeOf = (f: FormData) => { const r = String(f.get("locale") ?? "fa"); return isLocale(r) ? r : "fa"; };

async function savePermissions(formData: FormData) {
  "use server";
  const locale = localeOf(formData);
  const role = formData.get("role_id");
  if (!isUuid(role)) redirect(`/${locale}/admin/staff?r=unknown`);
  const wanted = new Set(formData.getAll("perm").map(String));
  const supabase = await createClient();
  const { data } = await supabase.from("role_permissions").select("permission_code").eq("role_id", role as string);
  const have = new Set(((data as { permission_code: string }[]) ?? []).map((x) => x.permission_code));
  const add = [...wanted].filter((p) => !have.has(p));
  const del = [...have].filter((p) => !wanted.has(p));
  let failed = false;
  if (add.length) failed = !!(await supabase.from("role_permissions").insert(add.map((p) => ({ role_id: role, permission_code: p })))).error;
  if (!failed && del.length) failed = !!(await supabase.from("role_permissions").delete().eq("role_id", role as string).in("permission_code", del)).error;
  redirect(`/${locale}/admin/staff?r=${failed ? "unknown" : "done"}#tpl-${role}`);
}

async function createTemplate(formData: FormData) {
  "use server";
  const locale = localeOf(formData);
  const scope = formData.get("scope") === "platform" ? "platform" : "pharmacy";
  const code = String(formData.get("code") ?? "").trim().toLowerCase();
  const name = String(formData.get("name_fa") ?? "").trim().slice(0, 60);
  if (!/^[a-z][a-z0-9_]{2,39}$/.test(code) || !name) redirect(`/${locale}/admin/staff?r=unknown`);
  const supabase = await createClient();
  const { error } = await supabase.from("roles").insert({ scope, code, name_fa: name, is_system: true });
  redirect(`/${locale}/admin/staff?r=${error ? "unknown" : "done"}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getStaffTexts(locale).dorvaStaffTitle, robots: { index: false } };
}

export default async function AdminStaffPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const s = getStaffTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/staff`);
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  if (!((perms as string[] | null) ?? []).includes("platform.roles.manage")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const sp = await searchParams;
  const [{ data: membersData }, { data: platRoles }, { data: phRoles }, { data: invData }, { data: permData }] = await Promise.all([
    supabase.rpc("staff_list", { p_pharmacy: null }),
    supabase.rpc("role_templates", { p_scope: "platform", p_pharmacy: null }),
    supabase.rpc("role_templates", { p_scope: "pharmacy", p_pharmacy: null }),
    supabase.from("staff_invites").select("id, email, role_id, created_at, expires_at").is("pharmacy_id", null).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("permissions").select("code, scope, description_fa").order("code"),
  ]);
  const { data: catData } = await supabase.rpc("permission_catalog", { p_scope: "platform", p_pharmacy: null });
  const permissions = (permData as Permission[]) ?? [];
  const back = `/${locale}/admin/staff`;
  const T = getTeamTexts(locale);
  const msg = sp.r ? (sp.r.startsWith("access_") ? (T.results[sp.r.slice(7)] ?? s.results.unknown) : (s.results[sp.r] ?? s.results.unknown)) : null;
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const editor = (title: string, scope: "platform" | "pharmacy", roles: RoleTemplate[]) => (
    <section className="space-y-3">
      <h3 className="font-bold">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <form key={r.id} id={`tpl-${r.id}`} action={savePermissions} className="card space-y-2">
            {hidden}<input type="hidden" name="role_id" value={r.id} />
            <p className="font-semibold">{r.name_fa} <span className="text-xs text-muted" dir="ltr">{r.code}</span></p>
            <div className="grid gap-1 text-xs">
              {permissions.filter((p) => p.scope === scope).map((p) => {
                const locked = LOCKED[r.code] === p.code;
                return (
                  <label key={p.code} className="flex items-center gap-2" title={locked ? s.locked : undefined}>
                    <input type="checkbox" name="perm" value={p.code} defaultChecked={r.permissions.includes(p.code)} disabled={locked} />
                    {locked && <input type="hidden" name="perm" value={p.code} />}
                    <span>{p.description_fa}</span> <span className="text-muted" dir="ltr">{p.code}</span>
                  </label>
                );
              })}
            </div>
            <SubmitButton className="btn-ghost py-1 text-xs">{s.savePerms}</SubmitButton>
          </form>
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="staff" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{s.dorvaStaffTitle}</h1>
      <p className="max-w-3xl text-sm text-muted">{s.intro}</p>
      {msg && (OK.has(sp.r!) || sp.r === "access_ok" ? <OkBox message={msg} /> : <ErrorBox message={msg} />)}
      <div className="max-w-3xl">
        <StaffPanel locale={locale} pharmacyId={null} back={back} members={(membersData as StaffMember[]) ?? []}
          invites={(invData as StaffInvite[]) ?? []} roles={(platRoles as RoleTemplate[]) ?? []} perms={(catData as Perm[]) ?? []} />
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">{s.templatesTitle}</h2>
        <p className="max-w-3xl text-sm text-muted">{s.templatesIntro}</p>
        <form action={createTemplate} className="card grid gap-2 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
          {hidden}
          <label><span className="label">{s.newTemplate}</span>
            <select name="scope" className="input"><option value="pharmacy">{s.pharmacyTemplates}</option><option value="platform">{s.platformTemplates}</option></select></label>
          <label><span className="label">{s.code}</span><input name="code" required pattern="[a-z][a-z0-9_]{2,39}" dir="ltr" className="input" /></label>
          <label><span className="label">{s.nameFa}</span><input name="name_fa" required maxLength={60} className="input" /></label>
          <SubmitButton className="btn">{s.create}</SubmitButton>
        </form>
        {editor(s.pharmacyTemplates, "pharmacy", (phRoles as RoleTemplate[]) ?? [])}
        {editor(s.platformTemplates, "platform", (platRoles as RoleTemplate[]) ?? [])}
      </section>
    </div>
  );
}
