import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getFilterTexts } from "@/i18n/dictionaries/filters";
import { getRules } from "@/i18n/dictionaries/rules";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Row = {
  facet_key: string; label: I18n; enabled: boolean; sort: number;
  searchable: boolean; show_counts: boolean; scope: string;
};

async function saveFilter(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const key = String(formData.get("facet_key") ?? "");
  const label = Object.fromEntries(
    ["fa", "en", "ar"].map((l) => [l, String(formData.get(`label_${l}`) ?? "").trim()]).filter(([, v]) => v),
  );
  const sort = Math.round(Number(String(formData.get("sort") ?? "").replace(/[٫,]/g, ".")));
  const scope = String(formData.get("scope") ?? "both");
  let ok = /^[a-z_]+$/.test(key) && Number.isFinite(sort) && ["both", "dorva", "pharmacy"].includes(scope);
  if (ok) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("catalog_filters").update({
      label, sort, scope,
      enabled: formData.get("enabled") === "on",
      searchable: formData.get("searchable") === "on",
      show_counts: formData.get("show_counts") === "on",
    }).eq("facet_key", key).select("facet_key");
    ok = !error && (data?.length ?? 0) > 0;
  }
  revalidatePath(`/${locale}/admin/filters`);
  redirect(`/${locale}/admin/filters?${ok ? "saved" : "error"}=${encodeURIComponent(key)}#f-${key}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getFilterTexts(locale).adminTitle, robots: { index: false } };
}

export default async function AdminFilters({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  const f = getFilterTexts(locale);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/filters`);
  const supabase = await createClient();

  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const permissions = (perms as string[] | null) ?? [];
  if (!permissions.includes("pharmacy.read_all") && !permissions.includes("settings.manage")) {
    return (
      <div className="card max-w-xl">
        <h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1>
        <p className="text-sm text-muted">{t.admin.noAccessBody}</p>
      </div>
    );
  }
  const canEdit = permissions.includes("settings.manage");
  const sp = await searchParams;

  const [{ data: rowsData }, { data: countsData }] = await Promise.all([
    supabase.from("catalog_filters").select("facet_key, label, enabled, sort, searchable, show_counts, scope").order("sort"),
    // how many distinct values each filter has across the whole catalog
    supabase.rpc("catalog_filter_options", { p_scope: "both" }),
  ]);
  const rows = (rowsData as Row[]) ?? [];
  const valueCount = new Map<string, number>();
  for (const r of (countsData as { facet_key: string }[]) ?? []) valueCount.set(r.facet_key, (valueCount.get(r.facet_key) ?? 0) + 1);

  return (
    <div>
      <AdminTabs locale={locale} current="filters" labels={getRules(locale)} />
      <h1 className="mb-1 text-2xl font-extrabold">{f.adminTitle}</h1>
      <p className="mb-5 max-w-3xl text-sm text-muted">{f.adminIntro}</p>
      {sp.saved && <div className="mb-4"><OkBox message={f.saved} /></div>}
      {sp.error && <div className="mb-4"><ErrorBox message={f.error} /></div>}
      {!canEdit && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{f.noEdit}</p>}

      <div className="space-y-3">
        {rows.map((r) => (
          <form key={r.facet_key} id={`f-${r.facet_key}`} action={saveFilter}
            className={`card grid gap-3 p-4 md:grid-cols-[1fr_auto] ${r.enabled ? "" : "opacity-70"}`}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="facet_key" value={r.facet_key} />
            <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-3">
              {(["fa", "en", "ar"] as const).map((l) => (
                <div key={l}>
                  <label className="label text-xs" htmlFor={`${r.facet_key}-${l}`}>{f.label} ({l})</label>
                  <input id={`${r.facet_key}-${l}`} name={`label_${l}`} defaultValue={r.label?.[l] ?? ""}
                    dir={l === "en" ? "ltr" : "rtl"} className="input py-2" />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-span-3 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={r.enabled} className="size-4 accent-brand-600" />{f.enabled}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="searchable" defaultChecked={r.searchable} className="size-4 accent-brand-600" />{f.searchable}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="show_counts" defaultChecked={r.show_counts} className="size-4 accent-brand-600" />{f.counts}</label>
                <label className="flex items-center gap-2">{f.sort}
                  <input name="sort" type="number" defaultValue={r.sort} className="input w-20 py-1.5" /></label>
                <label className="flex items-center gap-2">{f.scope}
                  <select name="scope" defaultValue={r.scope} className="input w-auto py-1.5">
                    {Object.entries(f.scopes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></label>
              </div>
            </fieldset>
            <div className="flex flex-col items-end justify-between gap-2">
              <code className="text-xs text-muted" dir="ltr">{r.facet_key}</code>
              {r.enabled && <span className="text-xs text-muted">{f.values(formatNumber(valueCount.get(r.facet_key) ?? 0, locale))}</span>}
              {canEdit && <SubmitButton className="btn text-sm" pendingLabel="…">{f.save}</SubmitButton>}
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
