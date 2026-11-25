import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { CategoryNames } from "@/components/CategoryNames";
import { getRound4Texts } from "@/i18n/dictionaries/round4";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, resolveLocale } from "@/i18n";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { getRules } from "@/i18n/dictionaries/rules";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Row = { code: string; name_fa: string; name_i18n: Record<string, string>; sort: number; active: boolean; group_code?: string };
type Kind = "insurer" | "kind" | "service_group" | "service";

async function saveRow(formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const locale = isLocale(get("locale")) ? get("locale") : "fa";
  const supabase = await createClient();
  const i18n: Record<string, string> = {};
  if (get("en")) i18n.en = get("en").slice(0, 80);
  if (get("ar")) i18n.ar = get("ar").slice(0, 80);
  const kind = get("kind");
  const common = { p_code: get("code").toLowerCase(), p_name_fa: get("name_fa"), p_i18n: i18n,
    p_sort: Number(get("sort")) || 100, p_active: formData.get("active") === "on" };
  const { data, error } = kind === "service_group" || kind === "service"
    ? await supabase.rpc("service_option_save", { ...common, p_kind: kind === "service" ? "service" : "group", p_group: get("group") || null })
    : await supabase.rpc("ref_list_save", { ...common, p_kind: kind });
  revalidatePath("/[locale]", "layout");
  redirect(`/${locale}/admin/lists?r=${error ? (error.code === "42501" ? "forbidden" : "unknown") : String(data)}#${get("kind")}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getProfileTexts(locale).listsTitle, robots: { index: false } };
}

// Dorva edits the lists pharmacies choose from: insurers and pharmacy types.
export default async function AdminLists({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/lists`);
  const P = getProfileTexts(locale);
  const supabase = await createClient();
  const [{ data: perms }, { data: ins }, { data: kinds }, { data: cats }, { data: sgroups }, { data: sopts }] = await Promise.all([
    supabase.rpc("my_platform_permissions"),
    supabase.from("insurers").select("code, name_fa, name_i18n, sort, active").order("sort"),
    supabase.from("pharmacy_kinds").select("code, name_fa, name_i18n, sort, active").order("sort"),
    supabase.rpc("category_names_admin"),
    supabase.from("pharmacy_service_groups").select("code, name_fa, name_i18n, sort, active").order("sort"),
    supabase.from("pharmacy_service_options").select("code, group_code, name_fa, name_i18n, sort, active").order("group_code").order("sort"),
  ]);
  const L5 = getRound5Texts(locale).lists;
  const groupRows = (sgroups as Row[]) ?? [];
  if (!((perms as string[] | null) ?? []).includes("settings.manage")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const sp = await searchParams;
  const table = (kind: Kind, title: string, rows: Row[]) => {
    const withGroup = kind === "service";
    const cols = withGroup ? "md:grid-cols-[8rem_9rem_1fr_1fr_1fr_4rem_3rem_auto]" : "md:grid-cols-[8rem_1fr_1fr_1fr_4rem_3rem_auto]";
    return (
    <section id={kind} className="card space-y-3">
      <h2 className="font-bold">{title}</h2>
      <div className={`hidden gap-2 text-xs text-muted md:grid ${cols}`}>
        <span>{P.code}</span>{withGroup && <span>{L5.group}</span>}<span>{P.nameFa}</span><span>{P.nameEn}</span><span>{P.nameAr}</span><span>{P.sort}</span><span>{P.active}</span><span />
      </div>
      {[...rows, null].map((r, i) => (
        <form key={r?.code ?? `new-${i}`} action={saveRow} className={`grid gap-2 md:items-center ${cols}`}>
          <input type="hidden" name="locale" value={locale} /><input type="hidden" name="kind" value={kind} />
          {r ? <><input type="hidden" name="code" value={r.code} /><code className="text-xs" dir="ltr">{r.code}</code></>
             : <input name="code" required dir="ltr" pattern="[a-z0-9_]{2,40}" placeholder={P.code} className="input py-1 text-sm" />}
          {withGroup && (
            <select name="group" required defaultValue={r?.group_code ?? ""} className="input py-1 text-sm" aria-label={L5.group}>
              <option value="" disabled>{L5.group}</option>
              {groupRows.map((g) => <option key={g.code} value={g.code}>{g.name_fa}</option>)}
            </select>
          )}
          <input name="name_fa" required defaultValue={r?.name_fa ?? ""} placeholder={P.nameFa} className="input py-1 text-sm" />
          <input name="en" dir="ltr" defaultValue={r?.name_i18n?.en ?? ""} placeholder={P.nameEn} className="input py-1 text-sm" />
          <input name="ar" defaultValue={r?.name_i18n?.ar ?? ""} placeholder={P.nameAr} className="input py-1 text-sm" />
          <input name="sort" type="number" defaultValue={r?.sort ?? 100} className="input py-1 text-sm" />
          <input name="active" type="checkbox" defaultChecked={r ? r.active : true} className="h-4 w-4 accent-brand-600" aria-label={P.active} />
          <SubmitButton className={r ? "btn-ghost py-1 text-xs" : "btn py-1 text-xs"}>{r ? t.common.save : P.add}</SubmitButton>
        </form>
      ))}
    </section>
    );
  };
  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="lists" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{P.listsTitle}</h1>
      <p className="max-w-3xl text-sm text-muted">{P.listsIntro}</p>
      {sp.r && <p role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{P.listResult[sp.r] ?? L5.result[sp.r] ?? P.listResult.unknown}</p>}
      {table("insurer", P.listInsurers, (ins as Row[]) ?? [])}
      {table("kind", P.listKinds, (kinds as Row[]) ?? [])}
      {table("service_group", L5.groups, groupRows)}
      {table("service", L5.services, (sopts as Row[]) ?? [])}
      <CategoryNames rows={(cats as { name_fa: string; name_i18n: Record<string, string>; products: number }[]) ?? []} texts={getRound4Texts(locale).cats} />
    </div>
  );
}
