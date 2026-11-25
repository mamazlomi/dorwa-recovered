import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { TranslateButton } from "@/components/AutoFill";
import { aiEnabled } from "@/lib/ai";
import { formatMoney, formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { COLLECTION_FIELDS, titleOf, UUID_RE, type CollectionRow } from "@/lib/collections";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Item = { product_id: string; name_fa: string; name_i18n: I18n; category_path: string[]; min_price: number | null; total: number };
type Opt = { facet_key: string; value_code: string; name_fa: string; name_i18n: I18n; products: number };

const LOCALES = ["fa", "en", "ar"] as const;
const ids = (formData: FormData, name: string) =>
  [...new Set(formData.getAll(name).map(String).filter((x) => UUID_RE.test(x)))];

function back(locale: string, id: string, extra: string): never {
  revalidatePath(`/${locale}/pharmacy/collections/${id}`);
  redirect(`/${locale}/pharmacy/collections/${id}?${extra}`);
}

async function current(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("collections").select("pharmacy_id, include_ids, exclude_ids").eq("id", id).maybeSingle();
  return { supabase, cur: data as { pharmacy_id: string | null; include_ids: string[]; exclude_ids: string[] } | null };
}

async function saveBasics(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) redirect(`/${locale}/pharmacy/collections`);
  const title = Object.fromEntries(LOCALES.map((l) => [l, String(formData.get(`title_${l}`) ?? "").trim()]).filter(([, v]) => v));
  const sort = Math.round(Number(formData.get("sort") ?? 100));
  const sortMode = String(formData.get("sort_mode") ?? "default");
  if (!title.fa || !Number.isFinite(sort) || !["default", "discount", "price_asc", "name"].includes(sortMode)) back(locale, id, "error=1");
  const supabase = await createClient();
  const { data, error } = await supabase.from("collections").update({
    title, sort, sort_mode: sortMode,
    status: formData.get("status") === "published" ? "published" : "draft",
    featured: formData.get("featured") === "on",
  }).eq("id", id).not("pharmacy_id", "is", null).select("id");
  back(locale, id, !error && (data?.length ?? 0) > 0 ? "saved=1" : "error=1");
}

// Ticks on the member list: unticked → out of the collection, ticked → in.
async function saveTicks(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) redirect(`/${locale}/pharmacy/collections`);
  const shown = ids(formData, "shown");
  const keep = new Set(ids(formData, "keep"));
  const { supabase, cur } = await current(id);
  if (!cur?.pharmacy_id) back(locale, id, "error=1");
  const inc = new Set(cur.include_ids), exc = new Set(cur.exclude_ids);
  for (const p of shown) {
    if (keep.has(p)) exc.delete(p);
    else if (inc.has(p)) inc.delete(p);
    else exc.add(p);
  }
  const { error } = await supabase.from("collections").update({ include_ids: [...inc], exclude_ids: [...exc] }).eq("id", id);
  back(locale, id, `${error ? "error=1" : "saved=1"}#members`);
}

// Suggestion tool: add the ticked suggestions.
async function addSelected(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) redirect(`/${locale}/pharmacy/collections`);
  const add = ids(formData, "add");
  const { supabase, cur } = await current(id);
  if (!cur?.pharmacy_id) back(locale, id, "error=1");
  const inc = new Set(cur.include_ids), exc = new Set(cur.exclude_ids);
  for (const p of add) { inc.add(p); exc.delete(p); }
  const { error } = await supabase.from("collections").update({ include_ids: [...inc].slice(0, 500), exclude_ids: [...exc] }).eq("id", id);
  back(locale, id, `${error ? "error=1" : "saved=1"}#members`);
}

async function setArchived(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) redirect(`/${locale}/pharmacy/collections`);
  const archive = formData.get("archive") === "1";
  const supabase = await createClient();
  const { error } = await supabase.from("collections")
    .update({ status: archive ? "archived" : "draft" }).eq("id", id).not("pharmacy_id", "is", null);
  back(locale, id, error ? "error=1" : archive ? "archived=1" : "restored=1");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getCollectionTexts(locale).phTitle, robots: { index: false } };
}

export default async function EditPharmacyCollection({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; archived?: string; restored?: string; s_section?: string; s_brand?: string; s_q?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  const c = getCollectionTexts(locale);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/collections/${id}`);
  const supabase = await createClient();
  const { data: colData } = await supabase.from("collections").select(COLLECTION_FIELDS).eq("id", id).not("pharmacy_id", "is", null).maybeSingle();
  const col = colData as CollectionRow | null;
  if (!col || !col.pharmacy_id) notFound();
  const phId = col.pharmacy_id;
  const sp = await searchParams;
  const sSection = (sp.s_section ?? "").slice(0, 120);
  const sBrand = (sp.s_brand ?? "").slice(0, 120);
  const sQ = (sp.s_q ?? "").trim().slice(0, 80);
  const suggesting = !!(sSection || sBrand || sQ);
  const fmt = (n: number) => formatNumber(n, locale);

  const sugFilters: Record<string, string[]> = {};
  if (sSection) sugFilters.section = [sSection];
  if (sBrand) sugFilters.brand = [sBrand];

  const [{ data: canData }, { data: phData }, { data: srcData }, { data: memData }, { data: excData }, { data: optData }, { data: sugData }] = await Promise.all([
    supabase.rpc("can_manage_collections", { p_pharmacy: phId }),
    supabase.from("pharmacies").select("id, slug, name_fa, name_i18n").eq("id", phId).maybeSingle(),
    col.source_id ? supabase.from("collections").select("title").eq("id", col.source_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("shop_search", { p_collection: col.id, p_limit: 200 }),
    // removed items that are still in this pharmacy's stock
    col.exclude_ids.length
      ? supabase.rpc("shop_search", { p_pharmacy: phId, p_limit: 200 })
      : Promise.resolve({ data: [] }),
    supabase.rpc("shop_filter_options", { p_pharmacy: phId, p_scope: "all" }),
    suggesting
      ? supabase.rpc("shop_search", { p_pharmacy: phId, p_filters: sugFilters, p_query: sQ || null, p_limit: 100 })
      : Promise.resolve({ data: [] }),
  ]);
  const canEdit = canData === true;
  const ph = phData as { id: string; slug: string; name_fa: string; name_i18n: I18n } | null;
  const srcTitle = srcData ? titleOf((srcData as { title: I18n }).title, locale) : "";
  const members = (memData as Item[]) ?? [];
  const memberIds = new Set(members.map((m) => m.product_id));
  const excSet = new Set(col.exclude_ids);
  const excluded = ((excData as Item[]) ?? []).filter((p) => excSet.has(p.product_id));
  const opts = (optData as Opt[]) ?? [];
  const sections = opts.filter((o) => o.facet_key === "section").sort((a, b) => b.products - a.products);
  const brands = opts.filter((o) => o.facet_key === "brand").sort((a, b) => localized(a.name_fa, a.name_i18n, locale).localeCompare(localized(b.name_fa, b.name_i18n, locale), locale));
  const suggestions = ((sugData as Item[]) ?? []).filter((p) => !memberIds.has(p.product_id));
  const listRow = (p: Item, name: string, checked: boolean) => (
    <li key={p.product_id}>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-brand-50">
        <input type="checkbox" name={name} value={p.product_id} defaultChecked={checked} className="size-4 accent-brand-600" />
        <span className="min-w-0 flex-1 truncate">{localized(p.name_fa, p.name_i18n, locale)}</span>
        <span className="shrink-0 text-xs text-muted">{formatMoney(p.min_price, locale)}</span>
      </label>
    </li>
  );

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/${locale}/pharmacy/collections?ph=${phId}`} className="text-sm text-brand-700 hover:underline">← {c.back}</Link>
        <h1 className="mt-1 text-2xl font-extrabold">{titleOf(col.title, locale)}</h1>
        <p className="text-sm text-muted">
          {ph ? localized(ph.name_fa, ph.name_i18n, locale) : ""} · {col.source_id ? c.followsDorva(srcTitle) : c.manualKind}
        </p>
      </div>
      {sp.saved && <OkBox message={c.saved} />}
      {sp.error && <ErrorBox message={c.error} />}
      {sp.archived && <OkBox message={c.archivedOk} />}
      {sp.restored && <OkBox message={c.restored} />}
      {!canEdit && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.phNoAccess}</p>}

      <form action={saveBasics} className="card space-y-3 p-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={col.id} />
        <fieldset disabled={!canEdit} className="space-y-3">
          <h2 className="font-bold">{c.basics}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {LOCALES.map((l) => (
              <div key={l}>
                <label className="label text-xs" htmlFor={`title-${l}`}>{c.title} ({l})</label>
                <input id={`title-${l}`} name={`title_${l}`} defaultValue={col.title?.[l] ?? ""} required={l === "fa"}
                  dir={l === "en" ? "ltr" : "rtl"} className="input py-2" />
              </div>
            ))}
          </div>
          <TranslateButton enabled={aiEnabled()} pharmacyId={phId}
            fields={{ title: { fa: "title-fa", en: "title-en", ar: "title-ar" } }}
            texts={{ translate: c.translate, translating: c.translating, off: c.translateOff, fail: c.translateFail, done: c.translateDone }} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label text-xs" htmlFor="status">{c.status}</label>
              <select id="status" name="status" defaultValue={col.status === "published" || col.status === "pending" ? "published" : "draft"} className="input py-2">
                {(["draft", "published"] as const).map((k) => <option key={k} value={k}>{c.statuses[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs" htmlFor="sort_mode">{c.orderMode}</label>
              <select id="sort_mode" name="sort_mode" defaultValue={col.sort_mode} className="input py-2">
                {Object.entries(c.orderModes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs" htmlFor="sort">{c.position}</label>
              <input id="sort" name="sort" type="number" defaultValue={col.sort} className="input py-2" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="featured" defaultChecked={col.featured} className="size-4 accent-brand-600" />{c.showOnPharmacy}
          </label>
        </fieldset>
        {canEdit && <SubmitButton className="btn" pendingLabel="…">{c.save}</SubmitButton>}
      </form>

      <div className="grid gap-5 lg:grid-cols-2">
        <form id="members" action={saveTicks} className="card space-y-3 p-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={col.id} />
          <h2 className="font-bold">{c.members} ({fmt(members.length)})</h2>
          <p className="text-xs text-muted">{c.membersHelp}</p>
          {[...members, ...excluded].map((p) => <input key={`s-${p.product_id}`} type="hidden" name="shown" value={p.product_id} />)}
          <fieldset disabled={!canEdit}>
            <ul className="max-h-[28rem] space-y-0.5 overflow-y-auto text-sm">
              {members.map((p) => listRow(p, "keep", true))}
              {excluded.length > 0 && <li className="px-2 pt-3 text-xs font-bold text-muted">{c.excluded}</li>}
              {excluded.map((p) => listRow(p, "keep", false))}
              {members.length + excluded.length === 0 && <li className="px-2 text-muted">{c.empty}</li>}
            </ul>
          </fieldset>
          {canEdit && members.length + excluded.length > 0 && <SubmitButton className="btn" pendingLabel="…">{c.saveTicks}</SubmitButton>}
        </form>

        <section className="card space-y-3 p-4">
          <h2 className="font-bold">{c.suggest}</h2>
          <p className="text-xs text-muted">{c.suggestHelp}</p>
          <form method="get" action={`/${locale}/pharmacy/collections/${col.id}#suggest`} className="grid gap-2 sm:grid-cols-2">
            <select name="s_section" defaultValue={sSection} className="input py-2" aria-label={c.anySection}>
              <option value="">{c.anySection}</option>
              {sections.map((o) => <option key={o.value_code} value={o.value_code}>{localized(o.name_fa, o.name_i18n, locale)} ({fmt(o.products)})</option>)}
            </select>
            <select name="s_brand" defaultValue={sBrand} className="input py-2" aria-label={c.anyBrand}>
              <option value="">{c.anyBrand}</option>
              {brands.map((o) => <option key={o.value_code} value={o.value_code}>{localized(o.name_fa, o.name_i18n, locale)} ({fmt(o.products)})</option>)}
            </select>
            <input type="search" name="s_q" defaultValue={sQ} placeholder={c.findProduct} aria-label={c.findProduct} className="input py-2 sm:col-span-2" />
            <button className="btn-ghost sm:col-span-2">{c.show}</button>
          </form>
          {suggesting && (
            <form id="suggest" action={addSelected} className="space-y-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={col.id} />
              <fieldset disabled={!canEdit}>
                <ul className="max-h-[24rem] space-y-0.5 overflow-y-auto text-sm">
                  {suggestions.map((p) => listRow(p, "add", true))}
                  {suggestions.length === 0 && <li className="px-2 text-muted">{c.noSuggestions}</li>}
                </ul>
              </fieldset>
              {canEdit && suggestions.length > 0 && <SubmitButton className="btn" pendingLabel="…">{c.addSelected} ({fmt(suggestions.length)})</SubmitButton>}
            </form>
          )}
        </section>
      </div>

      {canEdit && (
        <form action={setArchived} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={col.id} />
          <input type="hidden" name="archive" value={col.status === "archived" ? "0" : "1"} />
          {col.status !== "archived" && <p className="flex-1 text-xs text-muted">{c.archiveHelp}</p>}
          <SubmitButton className={`btn-ghost ${col.status === "archived" ? "" : "text-red-700"}`} pendingLabel="…">
            {col.status === "archived" ? c.restore : c.archive}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
