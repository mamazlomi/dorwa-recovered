import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { formatNumber, isLocale, resolveLocale, type Locale } from "@/i18n";
import { getRules } from "@/i18n/dictionaries/rules";
import { getReviewerTexts } from "@/i18n/dictionaries/reviewers";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Definition = {
  key: string; group_code: string; value_type: "number" | "boolean" | "enum" | "weights" | "text" | "color";
  options: unknown; min_value: number | null; max_value: number | null;
  unit: I18n | null; label: I18n; help: I18n | null; sort: number;
};
type EnumOption = { value: string; label: I18n };

const tr = (m: I18n | null | undefined, locale: Locale) => (m ? m[locale] ?? m.fa ?? "" : "");

async function updateSetting(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const key = String(formData.get("key"));
  const tabQ = String(formData.get("tab") ?? "").replace(/[^a-z]/g, "");
  const type = String(formData.get("type"));
  let value: unknown;
  if (type === "number") value = Number(String(formData.get("value") ?? "").replace(/[٫,]/g, "."));
  else if (type === "boolean") value = formData.get("value") === "on";
  else if (type === "weights") {
    value = Object.fromEntries(
      [...formData.entries()]
        .filter(([k]) => k.startsWith("w_"))
        .map(([k, v]) => [k.slice(2), Number(String(v).replace(/[٫,]/g, "."))]),
    );
  } else value = String(formData.get("value") ?? "");

  let ok = !(typeof value === "number" && !Number.isFinite(value));
  if (ok) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("settings")
      .update({ value })
      .eq("key", key).eq("scope", "platform").eq("scope_id", "")
      .select("key");
    ok = !error && (data?.length ?? 0) > 0;
  }
  revalidatePath(`/${locale}/admin/settings`);
  redirect(`/${locale}/admin/settings?${tabQ ? `tab=${tabQ}&` : ""}${ok ? "saved" : "error"}=${encodeURIComponent(key)}#${encodeURIComponent(key)}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getRules(locale).settingsTitle, robots: { index: false } };
}

export default async function AdminSettings({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string; tab?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  const a = { ...t.admin, ...getRules(locale) };
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/settings`);
  const supabase = await createClient();

  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const permissions = (perms as string[] | null) ?? [];
  if (!permissions.includes("pharmacy.read_all") && !permissions.includes("settings.manage")) {
    return (
      <div className="card max-w-xl">
        <h1 className="mb-2 text-xl font-bold">{a.noAccessTitle}</h1>
        <p className="text-sm text-muted">{a.noAccessBody}</p>
      </div>
    );
  }
  const canEdit = permissions.includes("settings.manage");
  const sp = await searchParams;

  const [{ data: defsData }, { data: valuesData }] = await Promise.all([
    supabase.from("setting_definitions").select("*").order("sort"),
    supabase.from("settings").select("key, value").eq("scope", "platform"),
  ]);
  // colors, logo and width moved to the theme studio; their old rows no longer do anything
  // the two approval switches were replaced by the content policy (moderation.*)
  const MOVED = ["theme.primary", "theme.highlight", "theme.accent", "theme.logo", "theme.page_width", "pages.pharmacy_approval", "theme.pharmacy_approval"];
  const defs = ((defsData as Definition[]) ?? []).filter((d) => !MOVED.includes(d.key));
  const values = new Map(((valuesData as { key: string; value: unknown }[]) ?? []).map((r) => [r.key, r.value]));
  const RT = getReviewerTexts(locale);
  const CAT_OF: Record<string, string> = {
    allocation: "orders", cart: "orders", prescription: "orders", payment: "orders", delivery: "orders", shipping: "orders", holding: "orders", customer: "orders",
    catalog: "catalog", catalog_sync: "catalog", enrich: "catalog", finder: "catalog", map: "catalog",
    pharmacy: "pharmacies", moderation: "pharmacies", forum: "community", review: "community", expert: "community",
    notify: "comms", seo: "comms", theme: "look",
  };
  const catOf = (g: string) => CAT_OF[g] ?? "other";
  const catKeys = ["orders", "catalog", "pharmacies", "community", "comms", "look", "other"].filter((c) => defs.some((d) => catOf(d.group_code) === c));
  const tab = catKeys.includes(sp.tab ?? "") ? sp.tab! : catKeys[0];
  const groups = [...new Set(defs.map((d) => d.group_code))].filter((g) => catOf(g) === tab);

  return (
    <div>
      <AdminTabs locale={locale} current="settings" labels={a} />
      <h1 className="mb-2 text-2xl font-extrabold">{a.settingsTitle}</h1>
      <p className="mb-6 max-w-3xl text-sm text-muted">{a.settingsIntro}</p>
      {!canEdit && <p className="mb-4 text-sm text-amber-800">{a.noSettingsAccess}</p>}
      <nav className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0" aria-label="settings sections">
        {catKeys.map((c) => (
          <Link key={c} href={`/${locale}/admin/settings?tab=${c}`} aria-current={c === tab ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm ${c === tab ? "bg-brand-700 font-bold text-white" : "border border-line bg-surface hover:bg-brand-50"}`}>
            {RT.tabs[c]}
          </Link>
        ))}
      </nav>

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="mb-3 text-lg font-bold">{a.groups[g] ?? RT.groups[g] ?? g}</h2>
            {g === "theme" && (
              <p className="mb-3 text-sm text-muted">
                {getLookTexts(locale).admin.themeHint}{" "}
                <Link href={`/${locale}/admin/pages`} className="font-semibold text-brand-700 hover:underline">{getLookTexts(locale).admin.homeBuilder}</Link>{" · "}
                <Link href={`/${locale}/admin/theme`} className="font-semibold text-brand-700 hover:underline">{getStudioTexts(locale).title}</Link>
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {defs.filter((d) => d.group_code === g).map((d) => {
                const v = values.get(d.key);
                const unit = tr(d.unit, locale);
                return (
                  <form key={d.key} id={d.key} action={updateSetting} className="card space-y-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="key" value={d.key} />
                    <input type="hidden" name="tab" value={tab} />
                    <input type="hidden" name="type" value={d.value_type} />
                    <label className="block font-semibold" htmlFor={`v-${d.key}`}>{tr(d.label, locale)}</label>
                    {d.help && <p className="text-xs leading-6 text-muted">{tr(d.help, locale)}</p>}

                    {d.value_type === "number" && (
                      <div className="flex items-center gap-2">
                        <input id={`v-${d.key}`} name="value" type="number" step="any" className="input max-w-40" dir="ltr"
                          defaultValue={String(v ?? "")} min={d.min_value ?? undefined} max={d.max_value ?? undefined} disabled={!canEdit} />
                        {unit && <span className="text-sm text-muted">{unit}</span>}
                      </div>
                    )}
                    {d.value_type === "number" && d.min_value != null && d.max_value != null && (
                      <p className="text-xs text-muted">{a.range(formatNumber(d.min_value, locale), formatNumber(d.max_value, locale))}</p>
                    )}
                    {d.value_type === "boolean" && (
                      <label className="flex items-center gap-2 text-sm">
                        <input id={`v-${d.key}`} name="value" type="checkbox" defaultChecked={v === true} disabled={!canEdit} />
                        {a.on}
                      </label>
                    )}
                    {d.value_type === "enum" && (
                      <select id={`v-${d.key}`} name="value" className="input" defaultValue={String(v ?? "")} disabled={!canEdit}>
                        {((d.options as EnumOption[]) ?? []).map((o) => (
                          <option key={o.value} value={o.value}>{tr(o.label, locale)}</option>
                        ))}
                      </select>
                    )}
                    {d.value_type === "weights" && (
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries((d.options as Record<string, I18n>) ?? {}).map(([k, label]) => (
                          <label key={k} className="text-sm">
                            <span className="mb-1 block text-muted">{tr(label, locale)}</span>
                            <input name={`w_${k}`} type="number" step="0.05" min={0} max={1} className="input" dir="ltr"
                              defaultValue={String(((v as Record<string, number>) ?? {})[k] ?? 0)} disabled={!canEdit} />
                          </label>
                        ))}
                      </div>
                    )}
                    {d.value_type === "color" && (
                      <div className="flex items-center gap-2">
                        <input id={`v-${d.key}`} name="value" type="color" className="h-10 w-16 cursor-pointer rounded-lg border border-line"
                          defaultValue={typeof v === "string" ? v : "#0e76a8"} disabled={!canEdit} />
                        <span className="text-sm text-muted" dir="ltr">{typeof v === "string" ? v : ""}</span>
                      </div>
                    )}
                    {d.value_type === "text" && (
                      <input id={`v-${d.key}`} name="value" className="input" defaultValue={String(v ?? "")} disabled={!canEdit} />
                    )}

                    {sp.saved === d.key && <OkBox message={a.savedSetting} />}
                    {sp.error === d.key && <ErrorBox message={a.settingError} />}
                    {canEdit && <button className="btn text-sm">{a.save}</button>}
                    <p className="text-[11px] text-muted" dir="ltr">{d.key}</p>
                  </form>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
