import { StockGrid, type GridRow } from "@/components/StockGrid";
import { ReviewStatus } from "@/components/ReviewStatus";
import { getRound4Texts } from "@/i18n/dictionaries/round4";
import { catNamer } from "@/lib/catNames";
import { getBulkTexts } from "@/i18n/dictionaries/bulk";
import { getToolTexts } from "@/i18n/dictionaries/tools";
import { StockExcel } from "@/components/StockExcel";
import Link from "next/link";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { getTeamTexts } from "@/i18n/dictionaries/team";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { formatMoney, formatNumber, isLocale, localized, resolveLocale, type Dict } from "@/i18n";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPanelTexts } from "@/i18n/dictionaries/panel";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { getDashboardTexts } from "@/i18n/dictionaries/dashboard";
import { getFinderTexts } from "@/i18n/dictionaries/finder";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { getPageTexts } from "@/i18n/dictionaries/pages";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Membership = {
  pharmacy_id: string;
  roles: { name_fa: string; name_i18n: I18n } | null;
  pharmacies: { id: string; slug: string; name_fa: string; name_i18n: I18n; status: string; review_note: string | null } | null;
};
type Product = { id: string; name_fa: string; name_i18n: I18n; dispensing_class: string };
type Row = {
  stock_id: string; product_id: string; name_fa: string; name_i18n: I18n; dispensing_class: string;
  category_path: string[]; facets: Record<string, string[] | string>; quantity: number; own_price: number | null;
  own_discount: number; cap: number; cap_source: string; effective_discount: number; list_price: number | null;
  final_price: number | null; published: boolean; price_requested: number | null; price_review_note: string | null;
};
type FacetValue = { facet_key: string; value_code: string; name_fa: string; name_i18n: I18n };
const STATUSES = ["clipped", "at_cap", "below", "none", "out"] as const;
const statusOf = (r: Row) => {
  const own = Number(r.own_discount), cap = Number(r.cap);
  const out: string[] = [];
  if (r.quantity === 0) out.push("out");
  if (own === 0) out.push("none");
  else if (own > cap) out.push("clipped");
  else if (own === cap) out.push("at_cap");
  else out.push("below");
  return out;
};
const brandsOf = (r: Row) => {
  const v = r.facets?.brand;
  return Array.isArray(v) ? v : v ? [v] : [];
};

function stockError(t: Dict, code: string, cap?: string, locale: "fa" | "en" | "ar" = "fa") {
  const e = t.dashboard.errors;
  if (code === "discount") return Number(cap) === 0 ? e.discountZero : e.discount(formatNumber(Number(cap ?? 0), locale));
  if (code === "price_cap" || code === "price_floor" || code === "forbidden") return e[code];
  return e.unknown;
}

async function saveStock(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const pharmacyId = String(formData.get("pharmacy_id"));
  const productId = String(formData.get("product_id"));
  const price = String(formData.get("price") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.from("stock_items").upsert(
    {
      pharmacy_id: pharmacyId,
      product_id: productId,
      quantity: Math.max(0, Number(formData.get("quantity") ?? 0)),
      discount_pct: Number(formData.get("discount_pct") ?? 0),
      price: price ? Number(price) * 10 : null, // form takes Toman, DB stores Rial
      source: "manual",
    },
    { onConflict: "pharmacy_id,product_id" },
  );
  revalidatePath(`/${locale}/pharmacy/dashboard`);
  let msg = "&saved=1";
  if (!error && price) {
    const { data: row } = await supabase.from("stock_items").select("price_requested").eq("pharmacy_id", pharmacyId).eq("product_id", productId).maybeSingle();
    if ((row as { price_requested: number | null } | null)?.price_requested) msg = "&saved=pending";
  }
  if (error) {
    const cap = /exceeds max allowed ([\d.]+)/.exec(error.message);
    msg = cap ? `&error=discount&cap=${Number(cap[1])}`
      : /above Dorva cap/.test(error.message) ? "&error=price_cap"
      : /below Dorva floor/.test(error.message) ? "&error=price_floor"
      : error.code === "42501" ? "&error=forbidden"
      : "&error=unknown";
  }
  redirect(`/${locale}/pharmacy/dashboard?ph=${pharmacyId}&p=${productId}${msg}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { t } = await resolveLocale(params);
  return { title: t.nav.pharmacyPanel };
}

export default async function Dashboard({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ph?: string; p?: string; cap?: string; registered?: string; saved?: string; error?: string;
    q?: string; cls?: string; cat?: string; brand?: string; st?: string; review?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/dashboard`);
  const sp = await searchParams;
  const d = t.dashboard;
  const supabase = await createClient();

  const { data } = await supabase
    .from("memberships")
    .select("pharmacy_id, roles(name_fa, name_i18n), pharmacies(id, slug, name_fa, name_i18n, status, review_note)")
    .eq("user_id", user.id)
    .not("pharmacy_id", "is", null);
  const memberships = ((data as unknown as Membership[]) ?? []).filter((m) => m.pharmacies);

  if (memberships.length === 0) {
    return (
      <div className="card max-w-xl space-y-3">
        <h1 className="text-xl font-bold">{d.noPharmacyTitle}</h1>
        <p className="text-sm text-muted">{d.noPharmacyBody}</p>
        <Link href={`/${locale}/pharmacy/register`} className="btn">{t.nav.register}</Link>
      </div>
    );
  }

  const current = memberships.find((m) => m.pharmacy_id === sp.ph) ?? memberships[0];
  const ph = current.pharmacies!;

  // show only what this person may use; with no access yet, say so and stop
  const { data: myPermData } = await supabase.rpc("my_pharmacy_permissions", { p_pharmacy: ph.id });
  const can = new Set((myPermData as string[] | null) ?? []);
  const P = getProfileTexts(locale);
  if (can.size === 0) {
    return (
      <div className="card max-w-xl space-y-2">
        <h1 className="text-xl font-bold">{localized(ph.name_fa, ph.name_i18n, locale)}</h1>
        <p className="text-sm text-muted">{P.noAccessYet}</p>
        <Link href={`/${locale}/account#profile`} className="btn-ghost inline-block">{getTeamTexts(locale).myProfile}</Link>
      </div>
    );
  }

  const pt = getPanelTexts(locale);
  const [{ data: rowsData }, { data: productsData }, { data: policiesData }, { data: facetData }, { data: capData }] = await Promise.all([
    supabase.rpc("pharmacy_stock_overview", { p_pharmacy: ph.id }),
    supabase.from("catalog_products").select("id, name_fa, name_i18n, dispensing_class, product_listings!inner(is_published)")
      .eq("product_listings.is_published", true).order("name_fa"),
    supabase.from("category_policies").select("dispensing_class, max_discount_pct"),
    supabase.from("catalog_facet_values").select("*").eq("facet_key", "brand").order("name_fa"),
    sp.p ? supabase.rpc("discount_cap", { p_product: sp.p }) : Promise.resolve({ data: [] }),
  ]);
  const rows = ((rowsData as Row[]) ?? []).sort((a, b) => a.name_fa.localeCompare(b.name_fa, "fa"));
  const products = (productsData as unknown as Product[]) ?? [];
  const capHint = ((policiesData as { dispensing_class: string; max_discount_pct: number }[]) ?? [])
    .map((c) => `${t.dispensing[c.dispensing_class]} ${formatNumber(Number(c.max_discount_pct), locale)}٪`)
    .join("، ");
  const name = (x: { name_fa: string; name_i18n: I18n }) => localized(x.name_fa, x.name_i18n, locale);
  const brands = (facetData as FacetValue[]) ?? [];
  const brandName = new Map(brands.map((b) => [b.value_code, name(b)]));
  const selectedCap = ((capData as { max_discount_pct: number; source: string }[]) ?? [])[0];
  const editing = rows.find((r) => r.product_id === sp.p);

  // filters (GET)
  const q = (sp.q ?? "").trim().toLowerCase();
  const categories = [...new Set(rows.map((r) => r.category_path[0]).filter(Boolean))].sort();
  const usedBrands = [...new Set(rows.flatMap(brandsOf))];
  const base = rows.filter((r) =>
    (!q || name(r).toLowerCase().includes(q)) &&
    (!sp.cls || r.dispensing_class === sp.cls) &&
    (!sp.cat || r.category_path[0] === sp.cat) &&
    (!sp.brand || brandsOf(r).includes(sp.brand)));
  const st = STATUSES.find((x) => x === sp.st);
  const shown = st ? base.filter((r) => statusOf(r).includes(st)) : base;
  const count = (k: string) => base.filter((r) => statusOf(r).includes(k)).length;
  const qs = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const all = { ph: ph.id, q: sp.q, cls: sp.cls, cat: sp.cat, brand: sp.brand, st: sp.st, ...extra };
    Object.entries(all).forEach(([k, v]) => v && u.set(k, v));
    return `/${locale}/pharmacy/dashboard?${u.toString()}`;
  };
  const catName = await catNamer(locale);
  const BT = getBulkTexts(locale);
  const TT = getToolTexts(locale);
  const { data: contribData } = await supabase.rpc("pharmacy_contribution", { p_pharmacy: ph.id });
  const contrib = contribData as { points: number; points_enabled: boolean; badge_enabled: boolean; badge_points: number;
    priority_enabled: boolean; priority: number; pending: number; approved: number; rejected: number } | null;
  const { data: platformPerms } = await supabase.rpc("my_platform_permissions");
  const priceApproval = !((platformPerms as string[] | null) ?? []).includes("policy.manage");
  const pctTxt = (n: number) => `${formatNumber(Number(n), locale)}٪`;

  return (
    <div className="space-y-6">
      {sp.registered && <OkBox message={d.registered} />}
      {sp.saved && <OkBox message={sp.saved === "pending" ? getRound4Texts(locale).bulk.pricePending : d.saved} />}
      {sp.error && <ErrorBox message={`${d.notSaved}: ${sp.error === "discount" && Number(sp.cap) > 0 ? pt.discountError(formatNumber(Number(sp.cap), locale)) : stockError(t, sp.error, sp.cap, locale)}`} />}

      {memberships.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {memberships.map((m) => (
            <Link key={m.pharmacy_id} href={`/${locale}/pharmacy/dashboard?ph=${m.pharmacy_id}`}
              className={m.pharmacy_id === ph.id ? "btn" : "btn-ghost"}>{name(m.pharmacies!)}</Link>
          ))}
        </div>
      )}

      <ReviewStatus locale={locale} pharmacy={ph.id} status={ph.status} reason={ph.review_note}
        canEdit={can.has("pharmacy.update_profile")} result={sp.review} />

      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{name(ph)}</h1>
          <p className="text-sm text-muted">
            {d.yourRole}: {current.roles ? name(current.roles) : ""} — {d.statusLabel}: {t.status[ph.status]}
          </p>
          {ph.review_note && ph.status !== "rejected" && <p className="mt-1 text-sm">{d.reviewNote}: {ph.review_note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {can.has("pharmacy.update_profile") && <Link href={`/${locale}/pharmacy/profile?ph=${ph.id}`} className="btn-ghost">{P.profileLink}</Link>}
          {can.has("pharmacy.collections.manage") && <Link href={`/${locale}/pharmacy/collections?ph=${ph.id}`} className="btn-ghost">{getCollectionTexts(locale).collectionsLink}</Link>}
          {can.has("pharmacy.settings.manage") && <Link href={`/${locale}/pharmacy/shipping?ph=${ph.id}`} className="btn-ghost">{getLogisticsTexts(locale).link}</Link>}
          {can.has("staff.manage") && <Link href={`/${locale}/pharmacy/staff?ph=${ph.id}`} className="btn-ghost">{getStaffTexts(locale).staffLink}</Link>}
          {can.has("order.read") && <Link href={`/${locale}/pharmacy/insights?ph=${ph.id}`} className="btn-ghost">{getDashboardTexts(locale).open}</Link>}
          {can.has("pharmacy.finder.manage") && <Link href={`/${locale}/pharmacy/finder?ph=${ph.id}`} className="btn-ghost">{getFinderTexts(locale).phLink}</Link>}
          {can.has("pharmacy.pages.manage") && <Link href={`/${locale}/pharmacy/page?ph=${ph.id}`} className="btn-ghost">{getPageTexts(locale).editLink}</Link>}
          {can.has("pharmacy.pages.manage") && <Link href={`/${locale}/pharmacy/look?ph=${ph.id}`} className="btn-ghost">{getStudioTexts(locale).lookLink}</Link>}
          {(can.has("inventory.manage") || can.has("inventory.read")) && <Link href={`/${locale}/pharmacy/scan?ph=${ph.id}`} className="btn-ghost">📷 {TT.scan.link}</Link>}
          <Link href={`/${locale}/${ph.slug}`} className="btn-ghost">{d.viewPage}</Link>
        </div>
      </section>

      {contrib && (contrib.points_enabled || contrib.pending > 0 || contrib.approved > 0) && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">{TT.contrib.title}</h2>
            <p className="text-xs text-muted">{TT.contrib.intro}</p>
            <p className="mt-1 text-sm">
              {contrib.points_enabled && <b>{TT.contrib.points.replace("{n}", formatNumber(contrib.points, locale))} · </b>}
              {TT.contrib.approved.replace("{n}", formatNumber(contrib.approved, locale))} · {TT.contrib.pending.replace("{n}", formatNumber(contrib.pending, locale))} · {TT.contrib.rejected.replace("{n}", formatNumber(contrib.rejected, locale))}
            </p>
            {contrib.priority_enabled && contrib.priority > 0 && <p className="text-xs text-brand-700">{TT.contrib.priority.replace("{n}", formatNumber(contrib.priority, locale))}</p>}
          </div>
          {contrib.badge_enabled && contrib.points_enabled && (
            <span className={`chip ${contrib.points >= contrib.badge_points ? "bg-emerald-50 text-emerald-800" : ""}`}>
              🏅 {TT.contrib.badge}: {contrib.points >= contrib.badge_points ? TT.contrib.badgeYes : TT.contrib.badgeNeed.replace("{n}", formatNumber(contrib.badge_points - contrib.points, locale))}
            </span>
          )}
        </section>
      )}

      {can.has("inventory.manage") && <StockExcel pharmacyId={ph.id} locale={locale} texts={TT.excel as unknown as Record<string, string>} errors={TT.excel.e} kinds={TT.excel.kinds} />}

      {can.has("inventory.manage") && <section id="stock-form" className="card space-y-4">
        <h2 className="font-bold">{d.stockForm}</h2>
        <form key={sp.p ?? "new"} action={saveStock} className="grid gap-3 sm:grid-cols-5">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="pharmacy_id" value={ph.id} />
          <div className="sm:col-span-2">
            <label className="label" htmlFor="product_id">{d.product}</label>
            <select id="product_id" name="product_id" required className="input" defaultValue={sp.p ?? products[0]?.id}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{name(p)} — {t.dispensing[p.dispensing_class]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="quantity">{d.quantity}</label>
            <input id="quantity" name="quantity" type="number" min={0} required className="input"
              defaultValue={editing ? String(editing.quantity) : undefined} />
          </div>
          <div>
            <label className="label" htmlFor="discount_pct">{d.discount}</label>
            <input id="discount_pct" name="discount_pct" type="number" min={0} max={100} step="0.5" className="input"
              defaultValue={editing ? String(Number(editing.own_discount)) : "0"} />
          </div>
          <div>
            <label className="label" htmlFor="price">{d.price}</label>
            <input id="price" name="price" type="number" min={1} className="input" placeholder={d.pricePlaceholder}
              defaultValue={editing?.own_price ? String(Number(editing.own_price) / 10) : undefined} />
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-5">
            <p className="text-xs text-muted">
              {selectedCap ? pt.capForProduct(formatNumber(Number(selectedCap.max_discount_pct), locale), pt.capSource[selectedCap.source] ?? selectedCap.source) : d.capHint(capHint)}
            </p>
            <button className="btn">{t.common.save}</button>
          </div>
        </form>
      </section>}

      <section className="card space-y-4">
        <h2 className="font-bold">{d.stockTable(formatNumber(rows.length, locale))}</h2>

        <form method="get" action={`/${locale}/pharmacy/dashboard`} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="ph" value={ph.id} />
          {sp.st && <input type="hidden" name="st" value={sp.st} />}
          <label><span className="label">{pt.search}</span>
            <input name="q" defaultValue={sp.q ?? ""} className="input" type="search" /></label>
          <label><span className="label">{d.category}</span>
            <select name="cls" defaultValue={sp.cls ?? ""} className="input">
              <option value="">{pt.allClasses}</option>
              {["general", "supplement", "otc", "rx"].map((c) => <option key={c} value={c}>{t.dispensing[c]}</option>)}
            </select></label>
          <label><span className="label">{pt.allCategories}</span>
            <select name="cat" defaultValue={sp.cat ?? ""} className="input">
              <option value="">{pt.allCategories}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label><span className="label">{pt.allBrands}</span>
            <select name="brand" defaultValue={sp.brand ?? ""} className="input">
              <option value="">{pt.allBrands}</option>
              {usedBrands.map((b) => <option key={b} value={b}>{brandName.get(b) ?? b}</option>)}
            </select></label>
          <div className="flex gap-2">
            <button className="btn">{pt.apply}</button>
            <Link href={`/${locale}/pharmacy/dashboard?ph=${ph.id}`} className="btn-ghost">{pt.clear}</Link>
          </div>
        </form>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={qs({ st: undefined })} className={`rounded-lg px-3 py-1.5 ${!st ? "bg-brand-700 text-white" : "border border-line hover:bg-brand-50"}`}>
            {pt.statuses.all} ({formatNumber(base.length, locale)})
          </Link>
          {STATUSES.map((k) => (
            <Link key={k} href={qs({ st: k })}
              className={`rounded-lg px-3 py-1.5 ${st === k ? "bg-brand-700 text-white" : k === "clipped" && count(k) > 0 ? "border border-amber-400 bg-amber-50 text-amber-900" : "border border-line hover:bg-brand-50"}`}>
              {pt.statuses[k]} ({formatNumber(count(k), locale)})
            </Link>
          ))}
        </div>
        {st && pt.statusHelp[st] && <p className="text-xs text-muted">{pt.statusHelp[st]}</p>}

        {shown.length === 0 ? (
          <p className="text-sm text-muted">{pt.noRows}</p>
        ) : (
          <>
            <p className="text-xs text-muted">{pt.shown(formatNumber(shown.length, locale), formatNumber(rows.length, locale))}</p>
            <StockGrid pharmacyId={ph.id} canEdit={can.has("inventory.manage")} approval={priceApproval} texts={getRound4Texts(locale).bulk}
              rows={shown.map((r): GridRow => {
                const sts = statusOf(r);
                return {
                  product_id: r.product_id, name: name(r),
                  sub: `${t.dispensing[r.dispensing_class]} · ${r.category_path.map(catName).join(" › ")}`,
                  note: [
                    sts.includes("clipped") ? pt.clippedNote(formatNumber(Number(r.own_discount), locale), formatNumber(Number(r.cap), locale)) : "",
                    r.price_requested ? BT.stock.pending.replace("{p}", formatMoney(r.price_requested, locale)) : "",
                    r.price_review_note ? BT.stock.rejected.replace("{n}", r.price_review_note) : "",
                  ].filter(Boolean).join(" — ") || undefined,
                  status: sts.map((k) => pt.statuses[k]).join("، "), clipped: sts.includes("clipped"),
                  quantity: r.quantity, discount: Number(r.own_discount), price: r.own_price ? Number(r.own_price) : null,
                  list_price: r.list_price ? Number(r.list_price) : null, cap: Number(r.cap),
                  capSource: pt.capSource[r.cap_source] ?? r.cap_source,
                  customer: r.final_price != null ? formatMoney(r.final_price, locale) : t.common.dash,
                  customerPct: Number(r.effective_discount) > 0 ? pctTxt(r.effective_discount) : "",
                  editHref: `${qs({ p: r.product_id })}#stock-form`,
                };
              })} />
          </>
        )}
      </section>
    </div>
  );
}
