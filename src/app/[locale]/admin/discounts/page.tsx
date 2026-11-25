import { BulkGrid } from "@/components/BulkGrid";
import { getBulkTexts } from "@/i18n/dictionaries/bulk";
import { saveCaps } from "@/lib/bulkActions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { formatNumber, isLocale, localized, resolveLocale, type Locale } from "@/i18n";
import { getDiscountTexts } from "@/i18n/dictionaries/discounts";
import { getRules } from "@/i18n/dictionaries/rules";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Scope = "category" | "facet" | "product";
type Cap = {
  id: string; scope: Scope; category_path: string[] | null; facet_key: string | null; facet_value: string | null;
  product_id: string | null; max_discount_pct: number; note: string | null; is_active: boolean; updated_at: string;
};
type ClassCap = { dispensing_class: string; max_discount_pct: number };
type FacetValue = { facet_key: string; value_code: string; name_fa: string; name_i18n: I18n };
type Product = { id: string; name_fa: string; name_i18n: I18n; dispensing_class: string; category_path: string[] };

const SEP = " › ";
const CLASSES = ["general", "supplement", "otc", "rx"];
const SCOPES: Scope[] = ["category", "facet", "product"];
const pct = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[٫,]/g, ".").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
};
const loc = (v: FormDataEntryValue | null): Locale => (isLocale(String(v)) ? (String(v) as Locale) : "fa");
const back = (locale: Locale, q: string) => `/${locale}/admin/discounts${q ? `?${q}` : ""}`;

async function saveCap(formData: FormData) {
  "use server";
  const locale = loc(formData.get("locale"));
  const scope = String(formData.get("scope")) as Scope;
  const max = pct(formData.get("max"));
  const row: Record<string, unknown> = { scope, max_discount_pct: max, note: String(formData.get("note") ?? "").trim() || null };
  if (scope === "category") row.category_path = String(formData.get("cat") ?? "").split(SEP).filter(Boolean);
  if (scope === "facet") {
    const [k, v] = String(formData.get("fv") ?? "").split("|");
    row.facet_key = k; row.facet_value = v;
  }
  if (scope === "product") row.product_id = isUuid(formData.get("pid")) ? formData.get("pid") : null;
  let status = "error";
  if (max != null && SCOPES.includes(scope)) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("discount_caps").insert(row).select("id");
    status = error?.code === "23505" ? "exists" : !error && data?.length ? "saved" : "error";
  }
  revalidatePath(`/${locale}/admin/discounts`);
  redirect(back(locale, `${status}=1#rules`));
}

async function updateCap(formData: FormData) {
  "use server";
  const locale = loc(formData.get("locale"));
  const id = formData.get("id");
  const change: Record<string, unknown> = {};
  if (formData.has("active")) change.is_active = formData.get("active") === "1";
  if (formData.has("max")) change.max_discount_pct = pct(formData.get("max"));
  let ok = isUuid(id) && Object.values(change).every((v) => v != null);
  if (ok) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("discount_caps").update(change).eq("id", id as string).select("id");
    ok = !error && (data?.length ?? 0) > 0;
  }
  revalidatePath(`/${locale}/admin/discounts`);
  redirect(back(locale, `${ok ? "saved" : "error"}=1#rules`));
}

async function saveClassCap(formData: FormData) {
  "use server";
  const locale = loc(formData.get("locale"));
  const cls = String(formData.get("cls"));
  const max = pct(formData.get("max"));
  let ok = CLASSES.includes(cls) && max != null;
  if (ok) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("category_policies")
      .update({ max_discount_pct: max }).eq("dispensing_class", cls).select("dispensing_class");
    ok = !error && (data?.length ?? 0) > 0;
  }
  revalidatePath(`/${locale}/admin/discounts`);
  redirect(back(locale, `${ok ? "classSaved" : "classError"}=${cls}#classes`));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getDiscountTexts(locale).title, robots: { index: false } };
}

export default async function AdminDiscounts({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale, t } = await resolveLocale(params);
  const d = getDiscountTexts(locale);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/discounts`);
  const supabase = await createClient();

  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const permissions = (perms as string[] | null) ?? [];
  if (!["pharmacy.read_all", "policy.manage", "settings.manage"].some((p) => permissions.includes(p))) {
    return (
      <div className="card max-w-xl">
        <h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1>
        <p className="text-sm text-muted">{t.admin.noAccessBody}</p>
      </div>
    );
  }
  const canEdit = permissions.includes("policy.manage");
  const BK = getBulkTexts(locale);
  const sp = await searchParams;
  const newScope = SCOPES.find((s) => s === sp.new);
  const pq = (sp.pq ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);

  const [{ data: capsData }, { data: classData }, { data: facetData }, { data: productData }, { data: foundData }] = await Promise.all([
    supabase.from("discount_caps").select("*").order("updated_at", { ascending: false }),
    supabase.from("category_policies").select("dispensing_class, max_discount_pct"),
    supabase.from("catalog_facet_values").select("*").order("facet_key").order("name_fa"),
    supabase.from("catalog_products").select("id, name_fa, name_i18n, dispensing_class, category_path").order("name_fa"),
    newScope === "product" && pq
      ? supabase.from("catalog_products").select("id, name_fa, name_i18n, dispensing_class, category_path").ilike("name_fa", `%${pq}%`).limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const caps = (capsData as Cap[]) ?? [];
  const classCaps = new Map(((classData as ClassCap[]) ?? []).map((c) => [c.dispensing_class, Number(c.max_discount_pct)]));
  const facets = (facetData as FacetValue[]) ?? [];
  const facetName = new Map(facets.map((f) => [`${f.facet_key}|${f.value_code}`, localized(f.name_fa, f.name_i18n, locale)]));
  const products = (productData as Product[]) ?? [];
  const productName = new Map(products.map((p) => [p.id, localized(p.name_fa, p.name_i18n, locale)]));
  const found = (foundData as Product[]) ?? [];
  const categories = [...new Set(products.flatMap((p) => p.category_path.map((_, i) => p.category_path.slice(0, i + 1).join(SEP))))].sort();
  const facetKeys = [...new Set(facets.map((f) => f.facet_key))];

  const label = (c: Pick<Cap, "scope" | "category_path" | "facet_key" | "facet_value" | "product_id">) =>
    c.scope === "category" ? (c.category_path ?? []).join(SEP)
    : c.scope === "facet" ? `${d.facetKeys[c.facet_key ?? ""] ?? c.facet_key}: ${facetName.get(`${c.facet_key}|${c.facet_value}`) ?? c.facet_value}`
    : productName.get(c.product_id ?? "") ?? "—";

  const filterScope = SCOPES.find((s) => s === sp.scope);
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = caps.filter((c) => (!filterScope || c.scope === filterScope) && (!q || label(c).toLowerCase().includes(q)));

  // Impact preview (GET form with preview=1)
  const pv = sp.preview === "1" && newScope ? {
    scope: newScope, cat: sp.cat ?? "", fv: sp.fv ?? "", pid: isUuid(sp.pid) ? sp.pid : "",
    max: pct(sp.max ?? null), note: sp.note ?? "",
  } : null;
  const pvReady = pv && pv.max != null && (pv.scope === "category" ? !!pv.cat : pv.scope === "facet" ? pv.fv.includes("|") : !!pv.pid);
  let impact: { products: number; offers_above: number } | null = null;
  if (pv && pvReady) {
    const [fk, fval] = pv.fv.split("|");
    const { data } = await supabase.rpc("discount_caps_impact", {
      p_scope: pv.scope,
      p_category_path: pv.scope === "category" ? pv.cat.split(SEP) : null,
      p_facet_key: pv.scope === "facet" ? fk : null,
      p_facet_value: pv.scope === "facet" ? fval : null,
      p_product: pv.scope === "product" ? pv.pid : null,
      p_max: pv.max,
    });
    impact = ((data as { products: number; offers_above: number }[]) ?? [])[0] ?? null;
  }
  const pvExists = pv && caps.some((c) =>
    c.scope === pv.scope && (pv.scope === "category" ? (c.category_path ?? []).join(SEP) === pv.cat
      : pv.scope === "facet" ? `${c.facet_key}|${c.facet_value}` === pv.fv : c.product_id === pv.pid));
  const date = (s: string) => new Date(s).toLocaleDateString(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US");
  const fmt = (n: number) => `${formatNumber(n, locale)}${locale === "en" ? "%" : "٪"}`;

  return (
    <div>
      <AdminTabs locale={locale} current="discounts" labels={getRules(locale)} />
      <h1 className="mb-2 text-2xl font-extrabold">{d.title}</h1>
      <p className="mb-6 max-w-3xl text-sm leading-7 text-muted">{d.intro}</p>
      {!canEdit && <p className="mb-4 text-sm text-amber-800">{d.noEdit}</p>}
      {sp.saved && <div className="mb-4"><OkBox message={d.saved} /></div>}
      {sp.error && <div className="mb-4"><ErrorBox message={d.error} /></div>}
      {sp.exists && <div className="mb-4"><ErrorBox message={d.exists} /></div>}

      {/* ---------- class defaults ---------- */}
      <section id="classes" className="mb-8">
        <h2 className="mb-3 text-lg font-bold">{d.classTitle}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CLASSES.map((cls) => (
            <form key={cls} action={saveClassCap} className="card space-y-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="cls" value={cls} />
              <label className="block font-semibold" htmlFor={`c-${cls}`}>{d.classes[cls]}</label>
              <div className="flex items-center gap-2">
                <input id={`c-${cls}`} name="max" type="number" step="0.5" min={0} max={100} dir="ltr" className="input w-24"
                  defaultValue={String(classCaps.get(cls) ?? 0)} disabled={!canEdit} />
                <span className="text-sm text-muted">٪</span>
                {canEdit && <SubmitButton className="btn-ghost text-sm">{d.saveClass}</SubmitButton>}
              </div>
              {sp.classSaved === cls && <OkBox message={d.saved} />}
              {sp.classError === cls && <ErrorBox message={d.error} />}
            </form>
          ))}
        </div>
      </section>

      {/* ---------- new rule ---------- */}
      {canEdit && (
        <section className="card mb-8 space-y-4">
          <h2 className="text-lg font-bold">{d.newTitle}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{d.chooseScope}:</span>
            {SCOPES.map((s) => (
              <Link key={s} href={back(locale, `new=${s}`)}
                className={`rounded-lg px-3 py-1.5 ${newScope === s ? "bg-brand-700 text-white" : "border border-line hover:bg-brand-50"}`}>
                {d.scopes[s]}
              </Link>
            ))}
          </div>

          {newScope === "product" && (
            <form method="get" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="new" value="product" />
              <label className="flex-1">
                <span className="label">{d.productSearch}</span>
                <input name="pq" defaultValue={pq} className="input" type="search" />
              </label>
              <button className="btn-ghost">{t.filters.apply}</button>
            </form>
          )}

          {newScope && (
            <form method="get" className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
              <input type="hidden" name="new" value={newScope} />
              <input type="hidden" name="preview" value="1" />
              {pq && <input type="hidden" name="pq" value={pq} />}
              {newScope === "category" && (
                <label>
                  <span className="label">{d.category}</span>
                  <select name="cat" required defaultValue={pv?.cat ?? ""} className="input">
                    <option value="" disabled>—</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {newScope === "facet" && (
                <label>
                  <span className="label">{d.facet}</span>
                  <select name="fv" required defaultValue={pv?.fv ?? ""} className="input">
                    <option value="" disabled>—</option>
                    {facetKeys.map((k) => (
                      <optgroup key={k} label={d.facetKeys[k] ?? k}>
                        {facets.filter((f) => f.facet_key === k).map((f) => (
                          <option key={f.value_code} value={`${k}|${f.value_code}`}>{localized(f.name_fa, f.name_i18n, locale)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
              {newScope === "product" && (
                <label>
                  <span className="label">{d.product}</span>
                  <select name="pid" required defaultValue={pv?.pid ?? ""} className="input">
                    <option value="" disabled>{(pq ? found : products).length ? d.pickProduct : d.noProducts}</option>
                    {(pq ? found : products).map((p) => (
                      <option key={p.id} value={p.id}>{localized(p.name_fa, p.name_i18n, locale)}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span className="label">{d.maxPct}</span>
                <input name="max" type="number" step="0.5" min={0} max={100} required dir="ltr" className="input"
                  defaultValue={pv?.max != null ? String(pv.max) : ""} />
              </label>
              <label>
                <span className="label">{d.note}</span>
                <input name="note" defaultValue={pv?.note ?? ""} className="input" maxLength={200} />
              </label>
              <button className="btn">{d.preview}</button>
            </form>
          )}

          {pv && pvReady && (
            <div className="rounded-xl border border-line p-4">
              <h3 className="mb-1 font-bold">{d.impactTitle}</h3>
              <p className="mb-1 text-sm">
                {label({ scope: pv.scope, category_path: pv.cat.split(SEP), facet_key: pv.fv.split("|")[0] || null,
                  facet_value: pv.fv.split("|")[1] || null, product_id: pv.pid || null })}
                {" — "}{fmt(pv.max!)}
              </p>
              {impact && (
                <p className="mb-3 text-sm text-muted">
                  {d.impact(formatNumber(impact.products, locale), formatNumber(impact.offers_above, locale))}
                </p>
              )}
              {pvExists ? (
                <ErrorBox message={d.exists} />
              ) : (
                <form action={saveCap}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="scope" value={pv.scope} />
                  <input type="hidden" name="cat" value={pv.cat} />
                  <input type="hidden" name="fv" value={pv.fv} />
                  <input type="hidden" name="pid" value={pv.pid} />
                  <input type="hidden" name="max" value={String(pv.max)} />
                  <input type="hidden" name="note" value={pv.note} />
                  <SubmitButton className="btn">{d.save}</SubmitButton>
                </form>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---------- bulk edit of all caps ---------- */}
      {canEdit && caps.length > 0 && (
        <section id="bulk" className="card mb-8 space-y-3">
          <h2 className="text-lg font-bold">{BK.caps.title}</h2>
          <p className="max-w-3xl text-sm text-muted">{BK.caps.intro}</p>
          <BulkGrid texts={BK.grid} errors={BK.errors} save={saveCaps}
            rows={caps.map((c) => ({
              id: c.id, title: label(c), sub: d.scopes[c.scope], note: c.note ?? undefined,
              values: { pct: String(Number(c.max_discount_pct)), active: c.is_active },
              info: { updated: new Date(c.updated_at).toLocaleDateString(locale === "fa" ? "fa-IR" : "en-GB", { timeZone: "Asia/Tehran" }) },
              tags: { scope: c.scope },
            }))}
            cols={[{ key: "pct", label: BK.caps.pct, kind: "number", min: 0, max: 100, step: 0.5 }, { key: "active", label: BK.caps.active, kind: "bool" }]}
            infos={[{ key: "updated", label: BK.caps.updated }]}
            filters={[{ key: "scope", label: BK.caps.scope, options: Object.fromEntries(SCOPES.map((x) => [x, d.scopes[x]])) }]}
            actions={[
              { key: "set", label: BK.caps.a_set, col: "pct", op: "set", placeholder: "10" },
              { key: "add", label: BK.caps.a_add, col: "pct", op: "add", placeholder: "-2" },
              { key: "on", label: BK.caps.a_on, col: "active", op: "on" },
              { key: "off", label: BK.caps.a_off, col: "active", op: "off" },
            ]} />
        </section>
      )}

      {/* ---------- rules list ---------- */}
      <section id="rules" className="space-y-3">
        <h2 className="text-lg font-bold">{d.rulesTitle}</h2>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label>
            <span className="label">{d.filterScope}</span>
            <select name="scope" defaultValue={filterScope ?? ""} className="input">
              <option value="">{d.scopes.all}</option>
              {SCOPES.map((s) => <option key={s} value={s}>{d.scopes[s]}</option>)}
            </select>
          </label>
          <label className="flex-1">
            <span className="label">{d.search}</span>
            <input name="q" defaultValue={sp.q ?? ""} className="input" type="search" />
          </label>
          <button className="btn-ghost">{t.filters.apply}</button>
        </form>

        {shown.length === 0 ? (
          <p className="text-sm text-muted">{d.noRules}</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line text-start">
                  <th className="p-3 text-start font-medium">{d.scope}</th>
                  <th className="p-3 text-start font-medium">{d.target}</th>
                  <th className="p-3 text-start font-medium">{d.cap}</th>
                  <th className="p-3 text-start font-medium">{d.status}</th>
                  <th className="p-3 text-start font-medium">{d.updated}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className={`border-b border-line last:border-0 ${c.is_active ? "" : "opacity-60"}`}>
                    <td className="p-3">{d.scopes[c.scope]}</td>
                    <td className="p-3">
                      {label(c)}
                      {c.note && <p className="text-xs text-muted">{c.note}</p>}
                    </td>
                    <td className="p-3">
                      {canEdit ? (
                        <form action={updateCap} className="flex items-center gap-1">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="id" value={c.id} />
                          <input name="max" type="number" step="0.5" min={0} max={100} dir="ltr" className="input w-20"
                            defaultValue={String(Number(c.max_discount_pct))} />
                          <SubmitButton className="btn-ghost text-xs">{d.saveClass}</SubmitButton>
                        </form>
                      ) : fmt(Number(c.max_discount_pct))}
                    </td>
                    <td className="p-3">
                      <span className={`chip ${c.is_active ? "" : "bg-gray-100 text-gray-700"}`}>{c.is_active ? d.active : d.inactive}</span>
                      {canEdit && (
                        <form action={updateCap} className="mt-1">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="active" value={c.is_active ? "0" : "1"} />
                          <SubmitButton className="text-xs text-brand-700 hover:underline">{c.is_active ? d.turnOff : d.turnOn}</SubmitButton>
                        </form>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted">{date(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
