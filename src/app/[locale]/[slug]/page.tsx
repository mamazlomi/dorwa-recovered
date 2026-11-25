import { getToolTexts } from "@/i18n/dictionaries/tools";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { formatMoney, formatNumber, getDictionary, isLocale, localized, resolveLocale, type Locale } from "@/i18n";
import { isConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { jsonLd, pageMeta, SITE_URL } from "@/lib/seo";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { addToCart } from "../cart/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ProductImage } from "@/components/ProductImage";
import { QtyStepper } from "@/components/QtyStepper";
import { getRules } from "@/i18n/dictionaries/rules";
import { getFilterTexts, sidebarTexts } from "@/i18n/dictionaries/filters";
import { ActiveFilters, Pager } from "@/components/CatalogParts";
import { FacetSidebar } from "@/components/FacetSidebar";
import { hrefWith, loadFilterGroups, loadFilterSettings, PAGE_SIZE, readFilters, SORTS, type SearchParams } from "@/lib/filters";
import { SortSelect } from "@/components/SortSelect";
import { findCollection, loadFeatured, titleOf } from "@/lib/collections";
import { CollectionRows } from "@/components/CollectionRows";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { PageBlocks } from "@/components/PageBlocks";
import { asBlocks } from "@/lib/pageBlocks";
import { getPageTexts } from "@/i18n/dictionaries/pages";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { loadTheme } from "@/lib/theme";
import { cardTexts, ProductCard } from "@/components/ProductCard";
import { ViewToggle } from "@/components/ViewToggle";
import { gridClass, listView } from "@/lib/view";
import { mediaUrl } from "@/lib/pageBlocks";
import { readCart } from "@/lib/cart";
import { getFixTexts } from "@/i18n/dictionaries/fixes";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { isOpen, PharmacyAbout } from "@/components/PharmacyAbout";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ locale: string; slug: string }> };
type Look = { accent?: string; logo?: string; cover?: string; coverTone?: string };
const COVER = { brand: "from-brand-700 to-brand-400", accent: "from-accent-700 to-brand-400", dark: "from-slate-900 to-slate-700", soft: "from-brand-100 to-brand-50" } as const;
type PageProps = Params & { searchParams: Promise<SearchParams> };
type I18n = Record<string, string>;
type Item = {
  product_id: string; name_fa: string; name_i18n: I18n; dispensing_class: string; category_path: string[];
  image_url: string | null; min_price: number | null; list_price: number | null; max_discount: number | null; total: number;
};
type Pharmacy = {
  id: string; slug: string; name_fa: string; name_i18n: I18n; address: string | null; about_fa: string | null;
  status: string; is_virtual: boolean; technical_officer_name: string | null;
  cities: { name_fa: string; name_i18n: I18n } | null;
  districts: { name_fa: string; name_i18n: I18n } | null;
  pharmacy_insurers: { insurers: { name_fa: string; name_i18n: I18n } | null }[] | null;
};

async function loadPharmacy(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pharmacies")
    .select("id, slug, name_fa, name_i18n, address, about_fa, status, is_virtual, technical_officer_name, cities(name_fa, name_i18n), districts(name_fa, name_i18n), pharmacy_insurers(insurers(name_fa, name_i18n))")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  return { supabase, pharmacy: data as unknown as Pharmacy | null };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  if (!isConfigured) return {};
  const { locale, slug } = await params;
  const l: Locale = isLocale(locale) ? locale : "fa";
  const { pharmacy } = await loadPharmacy(slug);
  if (!pharmacy) return { title: getDictionary(l).notFound.title, robots: { index: false } };
  const name = localized(pharmacy.name_fa, pharmacy.name_i18n, l);
  const city = pharmacy.cities ? localized(pharmacy.cities.name_fa, pharmacy.cities.name_i18n, l) : "";
  const lead: Record<string, string> = {
    fa: `داروخانه ${name}${city ? ` در ${city}` : ""}: خرید آنلاین دارو، مکمل و محصولات سلامت با تأیید داروساز.`,
    en: `${name}${city ? `, ${city}` : ""}: order medicines, supplements and health products online, checked by a pharmacist.`,
    ar: `${name}${city ? ` في ${city}` : ""}: اطلب الأدوية والمكملات عبر الإنترنت مع مراجعة الصيدلي.`,
  };
  return pageMeta({
    locale: l, path: `/${pharmacy.slug}`, title: name,
    description: `${lead[l] ?? lead.fa} ${l === "fa" ? pharmacy.about_fa ?? "" : ""}`,
    // test pharmacies and pharmacies not yet approved stay out of search engines
    noindex: pharmacy.is_virtual || pharmacy.status !== "active",
  });
}

export default async function PharmacyPage({ params, searchParams }: PageProps) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { slug } = await params;
  const { supabase, pharmacy } = await loadPharmacy(slug);
  if (!pharmacy) notFound();

  const sp = await searchParams;
  const base = `/${locale}/${pharmacy.slug}`;
  const fmt = (n: number) => formatNumber(n, locale);
  const ft = getFilterTexts(locale);
  const settings = await loadFilterSettings(supabase, "pharmacy");
  const { filters, q, page, col: colSlug, sort } = readFilters(sp, settings);
  const collection = await findCollection(supabase, colSlug, pharmacy.id);
  const col = collection?.slug ?? "";
  const state = { q, city: "", col, sort, filters };
  const browsing = !col && !q && !sort && Object.keys(filters).length === 0 && page === 1;
  const ct = getCollectionTexts(locale);

  const preview = (sp as Record<string, unknown>).preview === "1";
  const [{ data: itemsData, error }, groups, { data: limitsData }, { data: addedData }, featured, { data: canManage }, { data: liveLayout }, editor, theme] = await Promise.all([
    supabase.rpc("shop_search", {
      p_pharmacy: pharmacy.id, p_query: q || null, p_filters: filters, p_collection: collection?.id ?? null,
      p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE, p_sort: sort || null,
    }),
    loadFilterGroups(supabase, settings, {
      locale, scope: "pharmacy", cityId: null, q, filters, pharmacyId: pharmacy.id, collectionId: collection?.id ?? null,
      valueLabel: (key, v) => (key === "type" ? t.dispensing[v] : undefined),
    }),
    supabase.rpc("offer_limits", { p_pharmacy: pharmacy.id }),
    typeof sp.added === "string" && /^[0-9a-f-]{36}$/.test(sp.added)
      ? supabase.from("catalog_products").select("name_fa, name_i18n").eq("id", sp.added).maybeSingle()
      : Promise.resolve({ data: null }),
    browsing ? loadFeatured(supabase, pharmacy.id, null) : Promise.resolve([]),
    supabase.rpc("can_manage_collections", { p_pharmacy: pharmacy.id }),
    browsing ? supabase.rpc("page_public", { p_pharmacy: pharmacy.id }) : Promise.resolve({ data: null }),
    browsing && preview ? supabase.rpc("page_editor", { p_pharmacy: pharmacy.id }) : Promise.resolve({ data: null }),
    loadTheme(),
  ]);
  const [{ data: lookLive }, lookEd] = await Promise.all([
    supabase.rpc("pharmacy_look_public", { p_pharmacy: pharmacy.id }),
    preview ? supabase.rpc("pharmacy_look_editor", { p_pharmacy: pharmacy.id }) : Promise.resolve({ data: null }),
  ]);
  // Dorva staff may edit any pharmacy's page; say so, so it is never mistaken for one's own pharmacy
  const access = canManage === true ? ((await supabase.rpc("my_pharmacy_access", { p_pharmacy: pharmacy.id })).data as string | null) : null;
  const look = ((lookEd.data as { draft?: Look } | null)?.draft ?? (lookLive as Look | null) ?? {}) as Look;
  const draft = (editor.data as { draft?: unknown } | null)?.draft;
  const view = theme.grid.toggle ? await listView(theme.grid) : (theme.pharmacy.list === "list" ? "list" : "grid");
  const layout = asBlocks(draft ?? liveLayout);
  const items = (itemsData as Item[]) ?? [];
  const total = items[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const limits = new Map(((limitsData as { product_id: string; max_qty: number }[]) ?? []).map((x) => [x.product_id, x.max_qty]));
  // what is already in the basket counts against this pharmacy's stock
  const cartQty = new Map((await readCart()).items.map((l) => [l.p, l.q]));
  const X = getFixTexts(locale);
  const PT = getProfileTexts(locale);
  const tab = (sp as Record<string, unknown>).tab === "about" ? "about" : "products";
  const [{ data: aboutData }, { data: teamData }, { data: partner }] = await Promise.all([
    supabase.rpc("pharmacy_about_public", { p_pharmacy: pharmacy.id }),
    supabase.rpc("pharmacy_team_public", { p_pharmacy: pharmacy.id }),
    supabase.rpc("pharmacy_badge", { p_pharmacy: pharmacy.id }),
  ]);
  const about = aboutData as Parameters<typeof PharmacyAbout>[0]["about"] | null;
  const openNow = about ? isOpen(about.hours) : null;
  const capped = (sp as Record<string, unknown>).capped === "1";
  const addedName = addedData as { name_fa: string; name_i18n: I18n } | null;
  const activeCount = Object.values(filters).reduce((n, v) => n + v.length, 0);

  const place = [pharmacy.cities, pharmacy.districts]
    .filter(Boolean)
    .map((x) => localized(x!.name_fa, x!.name_i18n, locale))
    .join(" — ");

  const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const ld = {
    "@context": "https://schema.org", "@type": "Pharmacy",
    "@id": `${SITE_URL}/${locale}/${pharmacy.slug}#pharmacy`, url: `${SITE_URL}/${locale}/${pharmacy.slug}`,
    name: localized(pharmacy.name_fa, pharmacy.name_i18n, locale),
    ...(look.logo ? { logo: mediaUrl(look.logo), image: mediaUrl(look.logo) } : {}),
    ...(about?.phone ? { telephone: about.phone } : {}),
    address: { "@type": "PostalAddress", streetAddress: about?.address ?? pharmacy.address ?? undefined, addressCountry: "IR",
      addressLocality: pharmacy.cities ? localized(pharmacy.cities.name_fa, pharmacy.cities.name_i18n, locale) : undefined },
    ...(about?.lat && about?.lng ? { geo: { "@type": "GeoCoordinates", latitude: about.lat, longitude: about.lng } } : {}),
    openingHoursSpecification: about?.hours?.always
      ? [{ "@type": "OpeningHoursSpecification", dayOfWeek: DAYS, opens: "00:00", closes: "23:59" }]
      : (about?.hours?.shifts ?? []).map((x) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: x.days.map((d) => DAYS[d]), opens: x.from, closes: x.to })),
  };
  return (
    <div className="space-y-6">
      {pharmacy.status === "active" && !pharmacy.is_virtual && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />}
      {addedName && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <span>{t.cart.added} — {localized(addedName.name_fa, addedName.name_i18n, locale)}{capped && <> · <b className="text-amber-800">{X.capped}</b></>}</span>
          <Link href={`/${locale}/cart`} className="btn">{t.cart.goToCart}</Link>
        </div>
      )}
      {(() => {
        const name = localized(pharmacy.name_fa, pharmacy.name_i18n, locale);
        const badges = (
          <>
            {pharmacy.is_virtual && <span className="chip">{t.common.virtualPharmacy}</span>}
            {partner === true && <span className="chip bg-emerald-50 text-emerald-800">🏅 {getToolTexts(locale).badge}</span>}
            {pharmacy.status !== "active" && <span className="chip bg-amber-100 text-amber-800">{t.pharmacy.pendingBadge}</span>}
            {openNow != null && <span className={`chip ${openNow ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{openNow ? PT.openNow : PT.closedNow}</span>}
          </>
        );
        const logo = look.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(look.logo)} alt="" className="h-16 w-16 shrink-0 rounded-2xl border border-line bg-white object-contain p-1" />
        );
        const accent = look.accent ? ({ "--ph": look.accent } as React.CSSProperties) : undefined;
        if (theme.pharmacy.hero === "minimal") {
          return (
            <section className="flex flex-wrap items-center gap-3" style={accent}>
              {logo}
              <h1 className="text-2xl font-extrabold" style={look.accent ? { color: "var(--ph)" } : undefined}>{name}</h1>
              {badges}
              <span className="text-sm text-muted">{place}</span>
            </section>
          );
        }
        if (theme.pharmacy.hero === "cover") {
          return (
            <section className="overflow-hidden rounded-[var(--radius)] border border-line bg-white" style={accent}>
              <div className={`relative h-36 sm:h-48 bg-gradient-to-l ${COVER[(look.coverTone ?? "brand") as keyof typeof COVER] ?? COVER.brand}`}
                style={look.accent && !look.cover ? { background: `linear-gradient(90deg, ${look.accent}, var(--color-brand-400))` } : undefined}>
                {look.cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(look.cover)} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
              </div>
              <div className="relative px-5 pb-5">
                <div className="-mt-8 mb-2 flex flex-wrap items-end gap-3">
                  {logo || <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-white text-2xl font-extrabold text-brand-700">{name.slice(0, 1)}</span>}
                  <h1 className="text-2xl font-extrabold" style={look.accent ? { color: "var(--ph)" } : undefined}>{name}</h1>
                  {badges}
                </div>
                <p className="text-sm text-muted">{place}</p>
                {pharmacy.technical_officer_name && (
                  <p className="mt-2 text-sm">{t.pharmacy.techOfficer}: {pharmacy.technical_officer_name}</p>
                )}
                {(pharmacy.pharmacy_insurers ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(pharmacy.pharmacy_insurers ?? []).map((i, n) =>
                      i.insurers && <span key={n} className="chip">{localized(i.insurers.name_fa, i.insurers.name_i18n, locale)}</span>)}
                  </div>
                )}
                {pharmacy.about_fa && locale === "fa" && tab !== "about" && (
                  <p className="mt-4 leading-7">{pharmacy.about_fa.length > 180 ? `${pharmacy.about_fa.slice(0, 180)}… ` : `${pharmacy.about_fa} `}
                    <Link href={`${base}?tab=about`} className="text-brand-700 hover:underline">{PT.tabAbout}</Link></p>
                )}
                {canManage === true && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {access === "staff" && <p className="w-full rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{getRound5Texts(locale).staffAccess}</p>}
                    <Link href={`/${locale}/pharmacy/collections?ph=${pharmacy.id}`} className="btn-ghost text-sm">{ct.phTitle}</Link>
                    <Link href={`/${locale}/pharmacy/page?ph=${pharmacy.id}`} className="btn-ghost text-sm">{getPageTexts(locale).editLink}</Link>
                    <Link href={`/${locale}/pharmacy/look?ph=${pharmacy.id}`} className="btn-ghost text-sm">{getStudioTexts(locale).lookLink}</Link>
                  </div>
                )}
              </div>
            </section>
          );
        }
        return (
          <section className="card" style={accent}>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              {logo}
              <h1 className="text-2xl font-extrabold" style={look.accent ? { color: "var(--ph)" } : undefined}>{name}</h1>
              {badges}
            </div>
            <p className="text-sm text-muted">{place}</p>
                {pharmacy.technical_officer_name && (
                  <p className="mt-2 text-sm">{t.pharmacy.techOfficer}: {pharmacy.technical_officer_name}</p>
                )}
                {(pharmacy.pharmacy_insurers ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(pharmacy.pharmacy_insurers ?? []).map((i, n) =>
                      i.insurers && <span key={n} className="chip">{localized(i.insurers.name_fa, i.insurers.name_i18n, locale)}</span>)}
                  </div>
                )}
                {pharmacy.about_fa && locale === "fa" && tab !== "about" && (
                  <p className="mt-4 leading-7">{pharmacy.about_fa.length > 180 ? `${pharmacy.about_fa.slice(0, 180)}… ` : `${pharmacy.about_fa} `}
                    <Link href={`${base}?tab=about`} className="text-brand-700 hover:underline">{PT.tabAbout}</Link></p>
                )}
                {canManage === true && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {access === "staff" && <p className="w-full rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{getRound5Texts(locale).staffAccess}</p>}
                    <Link href={`/${locale}/pharmacy/collections?ph=${pharmacy.id}`} className="btn-ghost text-sm">{ct.phTitle}</Link>
                    <Link href={`/${locale}/pharmacy/page?ph=${pharmacy.id}`} className="btn-ghost text-sm">{getPageTexts(locale).editLink}</Link>
                    <Link href={`/${locale}/pharmacy/look?ph=${pharmacy.id}`} className="btn-ghost text-sm">{getStudioTexts(locale).lookLink}</Link>
                  </div>
                )}
          </section>
        );
      })()}

      <nav className="flex gap-2 border-b border-line" aria-label={PT.tabAbout}>
        {(["products", "about"] as const).map((k) => (
          <Link key={k} href={k === "about" ? `${base}?tab=about` : base} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}>
            {k === "about" ? PT.tabAbout : PT.tabProducts}
          </Link>
        ))}
      </nav>
      {tab === "about" && about ? (
        <PharmacyAbout about={about} team={(teamData as Parameters<typeof PharmacyAbout>[0]["team"]) ?? []} locale={locale}
          insurers={(pharmacy.pharmacy_insurers ?? []).flatMap((i) => (i.insurers ? [i.insurers] : []))} />
      ) : <>
      {draft != null && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{getPageTexts(locale).previewBar}</p>}
      {layout.length > 0
        ? <PageBlocks blocks={layout} locale={locale} supabase={supabase} pharmacyId={pharmacy.id} cityId={null} base={base} />
        : <CollectionRows groups={featured} locale={locale} seeAllBase={base} />}

      <div className="grid gap-5 lg:grid-cols-[17rem_1fr]">
        <FacetSidebar action={base} groups={groups} q={q} col={col} sort={sort} texts={sidebarTexts(locale)} locale={locale} activeCount={activeCount} />

        <section className="min-w-0 space-y-4">
          {collection && (
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-xl font-extrabold">{titleOf(collection.title, locale)}</h2>
              <Link href={base} className="text-sm text-brand-700 hover:underline">{ft.clearAll}</Link>
            </div>
          )}
          <form action={base} method="get" className="max-w-md">
            <label htmlFor="ph-q" className="label">{X.searchHere(localized(pharmacy.name_fa, pharmacy.name_i18n, locale))}</label>
            <div className="flex gap-2">
            <input id="ph-q" type="search" name="q" defaultValue={q} placeholder={X.searchHerePh} className="input" />
            {col && <input type="hidden" name="col" value={col} />}
            {sort && <input type="hidden" name="sort" value={sort} />}
            {Object.entries(filters).flatMap(([k, vals]) => vals.map((v) => <input key={`${k}|${v}`} type="hidden" name={k} value={v} />))}
            <button className="btn">{t.filters.apply}</button>
            </div>
          </form>
          <ActiveFilters base={base} state={state} groups={groups} texts={ft} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">{ft.found(fmt(total))} · {ft.techNote}</p>
            {theme.grid.toggle && <ViewToggle current={view} labels={getLookTexts(locale).extra.view} />}
            <SortSelect label={ct.sortLabel} current={sort || "recommended"}
              options={SORTS.map((v) => ({ value: v, label: ct.sortsPharmacy[v], href: hrefWith(base, { ...state, sort: v === "recommended" ? "" : v }) }))} />
          </div>

          {error ? (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{ft.loadError}</p>
          ) : items.length === 0 ? (
            <div className="card space-y-2 text-muted">
              <p>{q ? X.notHere(q) : activeCount ? ft.noResults : t.pharmacy.noStock}</p>
              {q && <Link href={`/${locale}/products?q=${encodeURIComponent(q)}`} className="btn-ghost inline-block text-sm text-brand-700">{X.searchSite(q)} ←</Link>}
            </div>
          ) : (
            <div className={view === "list" ? "space-y-2" : gridClass(theme.grid)}>
              {items.map((p) => {
                const isRx = p.dispensing_class === "rx";
                const stock = limits.get(p.product_id) ?? 10;
                const inCart = cartQty.get(p.product_id) ?? 0;
                const max = Math.max(stock - inCart, 0);
                return (
                  <ProductCard key={p.product_id} item={{ ...p, max_price: p.min_price, pharmacies: 1 }} locale={locale} card={theme.card}
                    view={view} single href={`/${locale}/product/${p.product_id}`} texts={cardTexts(locale)}>
                    <div className={view === "list" ? "shrink-0" : "mt-2"}>
                      {isRx && <p className="text-xs text-muted">{t.pharmacy.rxNote}</p>}
                      {!isRx && Number(p.max_discount) > 0 && p.list_price != null && (
                        <p className="text-xs text-muted line-through">{formatMoney(p.list_price, locale)}</p>
                      )}
                      {!isRx && inCart > 0 && <p className="text-xs font-semibold text-brand-700">{max > 0 ? X.inCart(fmt(inCart)) : X.allInCart}</p>}
                      {!isRx && pharmacy.status === "active" && max > 0 && (
                        <form action={addToCart} className="mt-1 flex items-center gap-2">
                          <input type="hidden" name="product_id" value={p.product_id} />
                          <input type="hidden" name="pharmacy_id" value={pharmacy.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="back" value={hrefWith(base, { ...state, page })} />
                          <QtyStepper name="qty" locale={locale} max={max} decLabel={t.cart.dec} incLabel={t.cart.inc} />
                          <SubmitButton className="btn min-w-0 flex-1 whitespace-nowrap text-sm" pendingLabel={getRules(locale).adding}>{t.cart.add}</SubmitButton>
                        </form>
                      )}
                      {!isRx && max > 0 && theme.lowStock > 0 && max <= theme.lowStock && (
                        <p className="mt-2 text-xs font-semibold text-amber-800">{getLookTexts(locale).product.onlyLeft(fmt(max))}</p>
                      )}
                    </div>
                  </ProductCard>
                );
              })}
            </div>
          )}
          <Pager base={base} state={state} page={page} pages={pages} texts={ft} fmt={fmt} />
        </section>
      </div>
      </>}
    </div>
  );
}
