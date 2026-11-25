import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { SuggestButton, TranslateButton } from "@/components/AutoFill";
import { RuleBuilder, type RuleKey } from "@/components/RuleBuilder";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getCollectionTexts, ruleBuilderTexts } from "@/i18n/dictionaries/collections";
import { getRules } from "@/i18n/dictionaries/rules";
import { aiEnabled } from "@/lib/ai";
import { COLLECTION_FIELDS, parseRules, SLUG_RE, titleOf, UUID_RE, type CollectionRow } from "@/lib/collections";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Item = { product_id: string; name_fa: string; name_i18n: I18n; category_path: string[] };
type Named = { id: string; name_fa: string; name_i18n: I18n };
type Opt = { facet_key: string; value_code: string; name_fa: string; name_i18n: I18n; products: number };

const LOCALES = ["fa", "en", "ar"] as const;
const i18nFrom = (formData: FormData, prefix: string) =>
  Object.fromEntries(LOCALES.map((l) => [l, String(formData.get(`${prefix}_${l}`) ?? "").trim()]).filter(([, v]) => v));

function back(locale: string, id: string, extra: string): never {
  revalidatePath(`/${locale}/admin/collections/${id}`);
  revalidatePath(`/${locale}/admin/collections`);
  redirect(`/${locale}/admin/collections/${id}?${extra}`);
}
const localeOf = (formData: FormData) => {
  const raw = String(formData.get("locale") ?? "fa");
  return isLocale(raw) ? raw : "fa";
};

// Two actions instead of one form with name="intent" buttons: the clicked
// button's value did not reach the server, so "publish" silently saved a draft.
async function savePublished(formData: FormData) {
  "use server";
  await saveCollection(formData, true);
}

async function saveDraftOnly(formData: FormData) {
  "use server";
  await saveCollection(formData, false);
}

async function saveCollection(formData: FormData, publish: boolean) {
  const locale = localeOf(formData);
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) redirect(`/${locale}/admin/collections`);
  const slugRaw = String(formData.get("slug") ?? "").trim().toLowerCase();
  const rules = parseRules(String(formData.get("rules") ?? "[]"));
  const title = i18nFrom(formData, "title");
  const rowLimit = Math.min(48, Math.max(4, Math.round(Number(formData.get("row_limit") ?? 12))));
  const sortMode = String(formData.get("sort_mode") ?? "default");
  if ((slugRaw && !SLUG_RE.test(slugRaw)) || !rules || !title.fa
      || !["default", "discount", "price_asc", "name"].includes(sortMode)) back(locale, id, "error=1");
  const defaultTab = formData.get("default_tab") === "on";
  const supabase = await createClient();
  // only one default tab: clear the others first
  if (defaultTab) await supabase.from("collections").update({ default_tab: false }).is("pharmacy_id", null).neq("id", id).eq("default_tab", true);
  const { data, error } = await supabase.from("collections").update({
    ...(slugRaw ? { slug: slugRaw } : {}),
    title, rules, row_limit: rowLimit, sort_mode: sortMode,
    show_as_tab: defaultTab || formData.get("show_as_tab") === "on",
    default_tab: defaultTab,
    description: i18nFrom(formData, "desc"),
    status: publish ? "published" : "draft",
    featured: formData.get("featured") === "on",
    only_discounted: formData.get("only_discounted") === "on",
  }).eq("id", id).is("pharmacy_id", null).select("id");
  const ok = !error && (data?.length ?? 0) > 0;
  // after publishing, go back to the list; a draft stays open for more editing
  if (ok && publish) {
    revalidatePath(`/${locale}/admin/collections`);
    redirect(`/${locale}/admin/collections?saved=1`);
  }
  back(locale, id, ok ? "saved=1" : "error=1");
}

async function setMember(formData: FormData) {
  "use server";
  const locale = localeOf(formData);
  const id = String(formData.get("id") ?? "");
  const product = String(formData.get("product") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const ps = String(formData.get("ps") ?? "");
  if (!UUID_RE.test(id) || !UUID_RE.test(product)) redirect(`/${locale}/admin/collections`);
  const supabase = await createClient();
  const { data: cur } = await supabase.from("collections").select("include_ids, exclude_ids").eq("id", id).maybeSingle();
  if (!cur) back(locale, id, "error=1");
  const inc = new Set<string>((cur.include_ids as string[]) ?? []);
  const exc = new Set<string>((cur.exclude_ids as string[]) ?? []);
  inc.delete(product); exc.delete(product);
  if (mode === "include") inc.add(product);
  if (mode === "exclude") exc.add(product);
  const { error } = await supabase.from("collections")
    .update({ include_ids: [...inc], exclude_ids: [...exc] }).eq("id", id).is("pharmacy_id", null);
  back(locale, id, `${error ? "error=1" : "saved=1"}${ps ? `&ps=${encodeURIComponent(ps)}` : ""}#manual`);
}

async function setArchived(formData: FormData) {
  "use server";
  const locale = localeOf(formData);
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) redirect(`/${locale}/admin/collections`);
  const archive = formData.get("archive") === "1";
  const supabase = await createClient();
  const { error } = await supabase.from("collections")
    .update({ status: archive ? "archived" : "draft" }).eq("id", id).is("pharmacy_id", null);
  back(locale, id, error ? "error=1" : archive ? "archived=1" : "restored=1");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getCollectionTexts(locale).adminTitle, robots: { index: false } };
}

export default async function EditCollection({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; ps?: string; archived?: string; restored?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  const c = getCollectionTexts(locale);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/collections/${id}`);
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const canEdit = ((perms as string[] | null) ?? []).includes("collections.manage");

  const { data: colData } = await supabase.from("collections").select(COLLECTION_FIELDS).eq("id", id).is("pharmacy_id", null).maybeSingle();
  const col = colData as CollectionRow | null;
  if (!col) notFound();
  const sp = await searchParams;
  const ps = (sp.ps ?? "").trim().slice(0, 80);
  const fmt = (n: number) => formatNumber(n, locale);
  const manualIds = [...col.include_ids, ...col.exclude_ids];

  const [{ data: filtersData }, { data: optsData }, { data: namesData }, { data: foundData }, { data: inColData }, { count: copies }] = await Promise.all([
    supabase.from("catalog_filters").select("facet_key, label, sort").order("sort"),
    supabase.rpc("shop_filter_options", { p_scope: "all" }),
    manualIds.length
      ? supabase.from("catalog_products").select("id, name_fa, name_i18n").in("id", manualIds)
      : Promise.resolve({ data: [] }),
    ps ? supabase.rpc("shop_search", { p_query: ps, p_limit: 20 }) : Promise.resolve({ data: [] }),
    // values inside this collection, for the suggested description
    supabase.rpc("shop_filter_options", { p_scope: "all", p_collection: col.id }),
    supabase.from("collections").select("id", { count: "exact", head: true }).eq("source_id", col.id),
  ]);
  const opts = (optsData as Opt[]) ?? [];
  const keys: RuleKey[] = ((filtersData as { facet_key: string; label: I18n }[]) ?? []).map((f) => ({
    key: f.facet_key,
    label: f.label?.[locale] || f.label?.fa || f.facet_key,
    options: opts.filter((o) => o.facet_key === f.facet_key)
      .map((o) => ({
        value: o.value_code,
        label: f.facet_key === "type" ? (t.dispensing[o.value_code] ?? o.value_code) : localized(o.name_fa, o.name_i18n, locale),
        count: o.products,
      }))
      .sort((a, b) => b.count - a.count),
  }));
  const names = new Map(((namesData as Named[]) ?? []).map((n) => [n.id, localized(n.name_fa, n.name_i18n, locale)]));
  const found = (foundData as Item[]) ?? [];
  const inSet = new Set(col.include_ids), exSet = new Set(col.exclude_ids);

  // Suggested Persian description from the collection's own contents (no AI).
  const inCol = (inColData as Opt[]) ?? [];
  const topOf = (k: string, n: number) => inCol.filter((o) => o.facet_key === k).sort((a, b) => b.products - a.products).slice(0, n);
  const fc = getCollectionTexts("fa");
  const sections = topOf("section", 2).map((o) => o.name_fa);
  const brands = topOf("brand", 3).map((o) => o.name_fa);
  const sectionTotal = topOf("section", 99).reduce((n, o) => n + o.products, 0);
  const suggestion = sectionTotal > 0
    ? fc.descTemplate(formatNumber(sectionTotal, "fa"), sections.join(" و ") || "", brands.length ? `${brands.join("، ")} ${fc.andMore}` : "")
    : "";
  const url = `dorva.vercel.app/${locale}/products?col=${col.slug}`;
  const archived = col.status === "archived";

  const memberForm = (product: string, mode: "include" | "exclude" | "clear", label: string, cls = "text-brand-700") => (
    <form action={setMember} className="inline">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={col.id} />
      <input type="hidden" name="product" value={product} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="ps" value={ps} />
      <button disabled={!canEdit} className={`text-xs hover:underline disabled:opacity-40 ${cls}`}>{label}</button>
    </form>
  );
  const field = (id: string, name: string, label: string, value: string, l: "fa" | "en" | "ar", required = false) => (
    <div>
      <label className="label text-xs" htmlFor={id}>{label} ({l})</label>
      <input id={id} name={name} defaultValue={value} required={required} dir={l === "en" ? "ltr" : "rtl"} className="input py-2" />
    </div>
  );

  return (
    <div>
      <AdminTabs locale={locale} current="collections" labels={getRules(locale)} />
      <Link href={`/${locale}/admin/collections`} className="text-sm text-brand-700 hover:underline">← {c.back}</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">{titleOf(col.title, locale)}</h1>
        <span className={`chip ${col.status === "published" ? "" : "bg-amber-100 text-amber-800"}`}>{c.statuses[col.status] ?? c.archived}</span>
      </div>
      {sp.saved && <div className="mb-4"><OkBox message={c.saved} /></div>}
      {sp.archived && <div className="mb-4"><OkBox message={c.archivedOk} /></div>}
      {sp.restored && <div className="mb-4"><OkBox message={c.restored} /></div>}
      {sp.error && <div className="mb-4"><ErrorBox message={c.error} /></div>}
      {!canEdit && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.noAccess}</p>}

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <form action={savePublished} className="space-y-5">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={col.id} />
            <fieldset disabled={!canEdit || archived} className="space-y-5">
              <section className="card space-y-3 p-4">
                <h2 className="font-bold">{c.stepName}</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {field("title-fa", "title_fa", c.title, col.title?.fa ?? "", "fa", true)}
                  {field("title-en", "title_en", c.title, col.title?.en ?? "", "en")}
                  {field("title-ar", "title_ar", c.title, col.title?.ar ?? "", "ar")}
                </div>
                <TranslateButton enabled={aiEnabled()}
                  fields={{ title: { fa: "title-fa", en: "title-en", ar: "title-ar" }, desc: { fa: "desc-fa", en: "desc-en", ar: "desc-ar" } }}
                  texts={{ translate: c.translate, translating: c.translating, off: c.translateOff, fail: c.translateFail, done: c.translateDone }} />
              </section>

              <section className="card space-y-3 p-4">
                <h2 className="font-bold">{c.stepProducts}</h2>
                <p className="text-xs text-muted">{c.rulesHelp}</p>
                <RuleBuilder name="rules" initial={col.rules ?? []} keys={keys} texts={ruleBuilderTexts(locale)} locale={locale}
                  disabled={!canEdit || archived} preview={{ include: col.include_ids, exclude: col.exclude_ids }} />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="only_discounted" defaultChecked={col.only_discounted} className="mt-1 size-4 accent-brand-600" />
                  <span>{c.onlyDiscounted}<span className="block text-xs text-muted">{c.onlyDiscountedHelp}</span></span>
                </label>
              </section>

              <section className="card space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-bold">{c.stepDesc}</h2>
                  {suggestion && <SuggestButton target="desc-fa" text={suggestion} label={c.suggestDesc} />}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {field("desc-fa", "desc_fa", c.description, col.description?.fa ?? "", "fa")}
                  {field("desc-en", "desc_en", c.description, col.description?.en ?? "", "en")}
                  {field("desc-ar", "desc_ar", c.description, col.description?.ar ?? "", "ar")}
                </div>
              </section>

              <section className="card space-y-3 p-4">
                <h2 className="font-bold">{c.stepShow}</h2>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="featured" defaultChecked={col.featured} className="mt-1 size-4 accent-brand-600" />
                  <span>{c.showOnHome}<span className="block text-xs text-muted">{c.showOnHomeHelp}</span></span>
                </label>
                <div className="max-w-xs">
                  <label className="label text-xs" htmlFor="row_limit">{c.rowSize}</label>
                  <input id="row_limit" name="row_limit" type="number" min={4} max={48} defaultValue={col.row_limit} className="input py-2" />
                  <p className="mt-1 text-xs text-muted">{c.rowSizeHelp}</p>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="show_as_tab" defaultChecked={col.show_as_tab} className="mt-1 size-4 accent-brand-600" />
                  <span>{c.showAsTab}<span className="block text-xs text-muted">{c.showAsTabHelp}</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="default_tab" defaultChecked={col.default_tab} className="mt-1 size-4 accent-brand-600" />
                  <span>{c.defaultTab}<span className="block text-xs text-muted">{c.defaultTabHelp}</span></span>
                </label>
                <p className="text-xs text-muted">{c.orderHelp}</p>
                <details className="rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">{c.advanced}</summary>
                  <p className="mt-2 text-xs text-muted">{c.advancedHelp}</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="label text-xs" htmlFor="slug">{c.slug}</label>
                      <input id="slug" name="slug" defaultValue={col.slug} pattern="[a-z0-9][a-z0-9\-]{1,59}" dir="ltr" className="input py-2" />
                      <p className="mt-1 text-xs text-muted" dir="auto">{c.slugHelp(url)}</p>
                      <p className="mt-1 text-xs text-amber-800">{c.slugWarn}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label text-xs" htmlFor="sort_mode">{c.orderMode}</label>
                      <select id="sort_mode" name="sort_mode" defaultValue={col.sort_mode} className="input py-2">
                        {Object.entries(c.orderModes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <p className="mt-1 text-xs text-muted">{c.orderModeHelp}</p>
                    </div>
                  </div>
                </details>
              </section>
            </fieldset>
            {canEdit && !archived && (
              <div className="flex flex-wrap gap-2">
                <SubmitButton className="btn" pendingLabel="…">{c.savePublish}</SubmitButton>
                <button formAction={saveDraftOnly} className="btn-ghost">{c.saveDraft}</button>
              </div>
            )}
          </form>

          <section id="manual" className="card space-y-4 p-4">
            <div>
              <h2 className="font-bold">{c.exceptions}</h2>
              <p className="text-xs text-muted">{c.exceptionsHelp}</p>
            </div>
            <form method="get" action={`/${locale}/admin/collections/${col.id}#manual`} className="flex max-w-md gap-2">
              <input type="search" name="ps" defaultValue={ps} placeholder={c.findProduct} aria-label={c.findProduct} className="input py-2" />
              <button className="btn-ghost">{c.find}</button>
            </form>
            {ps && (
              <ul className="divide-y divide-line text-sm">
                {found.map((p) => (
                  <li key={p.product_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 flex-1">{localized(p.name_fa, p.name_i18n, locale)} <span className="text-xs text-muted">· {p.category_path.join(" › ")}</span></span>
                    <span className="flex gap-3">
                      {!inSet.has(p.product_id) && memberForm(p.product_id, "include", c.include)}
                      {!exSet.has(p.product_id) && memberForm(p.product_id, "exclude", c.excludeShort, "text-red-700")}
                    </span>
                  </li>
                ))}
                {found.length === 0 && <li className="py-2 text-muted">{c.noSuggestions}</li>}
              </ul>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {([["included", col.include_ids], ["excluded", col.exclude_ids]] as const).map(([k, ids]) => (
                <div key={k}>
                  <h3 className="mb-1 text-sm font-bold">{c[k]}</h3>
                  {ids.length === 0 ? <p className="text-xs text-muted">{c.none}</p> : (
                    <ul className="space-y-1 text-sm">
                      {ids.map((pid) => (
                        <li key={pid} className="flex items-center justify-between gap-2">
                          <span className="truncate">{names.get(pid) ?? pid}</span>
                          {memberForm(pid, "clear", c.undo)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          {col.status === "published" && (
            <Link href={`/${locale}/products?col=${col.slug}`} className="btn-ghost w-full text-sm">{c.viewPublic}</Link>
          )}
          {canEdit && (
            <form action={setArchived} className="card space-y-2 p-4 text-sm">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={col.id} />
              <input type="hidden" name="archive" value={archived ? "0" : "1"} />
              {!archived && <p className="text-xs text-muted">{c.archiveHelp}</p>}
              {!archived && (copies ?? 0) > 0 && <p className="text-xs text-amber-800">{c.copiesWarn(fmt(copies ?? 0))}</p>}
              <SubmitButton className={`btn-ghost w-full ${archived ? "" : "text-red-700"}`} pendingLabel="…">
                {archived ? c.restore : c.archive}
              </SubmitButton>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
