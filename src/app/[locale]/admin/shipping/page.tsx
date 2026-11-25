import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney, formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import { getRules } from "@/i18n/dictionaries/rules";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Ph = { id: string; slug: string; name_fa: string; name_i18n: I18n; status: string; is_virtual: boolean };
type Ship = {
  pharmacy_id: string; admin_allowed: boolean | null; own_courier: boolean; base_fee_rial: number | null;
  per_km_rial: number | null; radius_km: number | null; intercity_accept: boolean;
};

const localeOf = (f: FormData) => { const r = String(f.get("locale") ?? "fa"); return isLocale(r) ? r : "fa"; };

async function setMode(formData: FormData) {
  "use server";
  const locale = localeOf(formData);
  const mode = formData.get("mode") === "pharmacy_allowed" ? "pharmacy_allowed" : "dorva";
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").update({ value: mode })
    .eq("key", "shipping.provider_mode").eq("scope", "platform").eq("scope_id", "").select("key");
  redirect(`/${locale}/admin/shipping?${!error && data?.length ? "ok=1" : "err=1"}`);
}
async function setDefault(formData: FormData) {
  "use server";
  const locale = localeOf(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").update({ value: formData.get("allowed") === "1" })
    .eq("key", "shipping.pharmacy_default_allowed").eq("scope", "platform").eq("scope_id", "").select("key");
  redirect(`/${locale}/admin/shipping?${!error && data?.length ? "ok=1" : "err=1"}`);
}
async function setPermission(formData: FormData) {
  "use server";
  const locale = localeOf(formData);
  const id = formData.get("pharmacy_id");
  if (!isUuid(id)) redirect(`/${locale}/admin/shipping?err=1`);
  const v = String(formData.get("allowed"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_pharmacy_shipping_allow", { p_pharmacy: id, p_allowed: v === "yes" ? true : v === "no" ? false : null });
  redirect(`/${locale}/admin/shipping?${error ? "err=1" : "ok=1"}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getLogisticsTexts(locale).adminTitle, robots: { index: false } };
}

export default async function AdminShippingPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const L = getLogisticsTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/shipping`);
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const permissions = (perms as string[] | null) ?? [];
  if (!permissions.includes("pharmacy.read_all") && !permissions.includes("settings.manage")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const canEdit = permissions.includes("settings.manage");
  const sp = await searchParams;

  const [{ data: setData }, { data: phData }, { data: shData }] = await Promise.all([
    supabase.from("settings").select("key, value").eq("scope", "platform").in("key", ["shipping.provider_mode", "shipping.pharmacy_default_allowed"]),
    supabase.from("pharmacies").select("id, slug, name_fa, name_i18n, status, is_virtual").eq("status", "active").order("name_fa"),
    supabase.from("pharmacy_shipping").select("pharmacy_id, admin_allowed, own_courier, base_fee_rial, per_km_rial, radius_km, intercity_accept"),
  ]);
  const settings = new Map(((setData as { key: string; value: unknown }[]) ?? []).map((r) => [r.key, r.value]));
  const mode = settings.get("shipping.provider_mode") === "pharmacy_allowed" ? "pharmacy_allowed" : "dorva";
  const defAllowed = settings.get("shipping.pharmacy_default_allowed") !== false;
  const ships = new Map(((shData as Ship[]) ?? []).map((s) => [s.pharmacy_id, s]));
  const pharmacies = (phData as Ph[]) ?? [];
  const fmt = (n: number) => formatNumber(n, locale);
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="shipping" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{L.adminTitle}</h1>
      <p className="max-w-3xl text-sm text-muted">{L.adminIntro}</p>
      {sp.ok && <OkBox message="✓" />}
      {sp.err && <ErrorBox message={t.dashboard.errors.unknown} />}

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className={`font-bold ${mode === "dorva" ? "" : "text-brand-700"}`}>{mode === "dorva" ? L.modeNowDorva : L.modeNowPharmacy}</p>
          <p className="text-xs text-muted">{defAllowed ? L.defaultAllowed : L.defaultBlocked}</p>
          <Link href={`/${locale}/admin/settings#shipping.ph_base_fee_max_rial`} className="text-xs text-brand-700 hover:underline">{L.boundsLink}</Link>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <form action={setMode}>{hidden}
              <input type="hidden" name="mode" value={mode === "dorva" ? "pharmacy_allowed" : "dorva"} />
              <SubmitButton className={mode === "dorva" ? "btn" : "btn bg-red-700 hover:bg-red-800"}>
                {mode === "dorva" ? L.allowPharmacies : L.centralize}
              </SubmitButton>
            </form>
            <form action={setDefault}>{hidden}
              <input type="hidden" name="allowed" value={defAllowed ? "0" : "1"} />
              <SubmitButton className="btn-ghost">{defAllowed ? L.defaultBlocked : L.defaultAllowed}</SubmitButton>
            </form>
          </div>
        )}
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-2 text-start">{L.colPharmacy}</th>
              <th className="text-start">{L.colPermission}</th>
              <th className="text-start">{L.colOwn}</th>
              <th className="text-start">{L.colRates}</th>
              <th className="text-start">{L.colState}</th>
            </tr>
          </thead>
          <tbody>
            {pharmacies.map((p) => {
              const s = ships.get(p.id);
              const allowed = mode === "pharmacy_allowed" && (s?.admin_allowed ?? defAllowed);
              const active = allowed && !!s?.own_courier;
              const perm = s?.admin_allowed == null ? "follow" : s.admin_allowed ? "yes" : "no";
              return (
                <tr key={p.id} className="border-b border-line align-top last:border-0">
                  <td className="py-2">
                    <Link href={`/${locale}/pharmacy/shipping?ph=${p.id}`} className="text-brand-700 hover:underline">{localized(p.name_fa, p.name_i18n, locale)}</Link>
                    {p.is_virtual && <span className="ms-1 text-xs text-muted">({t.common.virtual})</span>}
                  </td>
                  <td>
                    {canEdit ? (
                      <form action={setPermission} className="flex gap-1">{hidden}
                        <input type="hidden" name="pharmacy_id" value={p.id} />
                        <select name="allowed" defaultValue={perm} className="input py-1 text-xs">
                          <option value="follow">{L.follow}</option>
                          <option value="yes">{L.allow}</option>
                          <option value="no">{L.block}</option>
                        </select>
                        <SubmitButton className="btn-ghost py-1 text-xs">{L.apply}</SubmitButton>
                      </form>
                    ) : perm === "follow" ? L.follow : perm === "yes" ? L.allow : L.block}
                  </td>
                  <td>{s?.own_courier ? "✓" : "—"}</td>
                  <td className="text-xs">
                    {s && (s.base_fee_rial != null || s.per_km_rial != null)
                      ? `${formatMoney(s.base_fee_rial, locale)} + ${formatMoney(s.per_km_rial, locale)}/km`
                      : "—"}
                    {s?.radius_km != null && <p className="text-muted">r ≤ {fmt(Number(s.radius_km))} km</p>}
                    {s && !s.intercity_accept && <p className="text-amber-800">{L.noIntercity}</p>}
                  </td>
                  <td><span className={`chip ${active ? "bg-brand-50 text-brand-700" : ""}`}>{active ? L.stateActive : L.stateDorva}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
