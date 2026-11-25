import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { ActiveFilters, Pager } from "@/components/CatalogParts";
import { FacetSidebar } from "@/components/FacetSidebar";
import { ProductImage } from "@/components/ProductImage";
import { SetupNotice } from "@/components/SetupNotice";
import { formatMoney, formatNumber, localized, resolveLocale } from "@/i18n";
import { getCatalogTexts } from "@/i18n/dictionaries/catalog";
import { getFilterTexts, sidebarTexts } from "@/i18n/dictionaries/filters";
import { isConfigured } from "@/lib/config";
import { hrefWith, loadFilterGroups, loadFilterSettings, PAGE_SIZE, readFilters, SORTS, type SearchParams } from "@/lib/filters";
import { SortSelect } from "@/components/SortSelect";
import { findCollection, titleOf } from "@/lib/collections";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { createClient } from "@/lib/supabase/server";
import { AddedBar } from "@/components/QuickAdd";
import { cardTexts, ProductCard } from "@/components/ProductCard";
import { ViewToggle } from "@/components/ViewToggle";
import { loadTheme } from "@/lib/theme";
import { gridClass, listView } from "@/lib/view";
import { getRules } from "@/i18n/dictionaries/rules";
import { getLookTexts } from "@/i18n/dictionaries/look";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type City = { id: number; slug: string; name_fa: string; name_i18n: I18n };
type Item = {
  product_id: string; name_fa: string; name_i18n: I18n; dispensing_class: string; category_path: string[];
  image_url: string | null; min_price: number | null; max_price: number | null; max_discount: number | null;
  pharmacies: number; total: number;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  const c = getCatalogTexts(locale);
  return pageMeta({ locale, path: "/products", title: c.title, description: c.intro });
}

export default async function Products({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, t } = await resolveLocale(params);
  const c = getCatalogTexts(locale);
  const ft = getFilterTexts(locale);
  const L = getLookTexts(locale);
  const theme = await loadTheme();
  const view = await listView(theme.grid);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const sp = await searchParams;
  const supabase = await createClient();
  const base = `/${locale}/products`;
  const fmt = (n: number) => formatNumber(n, locale);

  const [{ data: citiesData }, settings, { data: tabsData }] = await Promise.all([
    supabase.from("cities").select("id, slug, name_fa, name_i18n").order("id"),
    loadFilterSettings(supabase, "dorva"),
    supabase.rpc("product_tabs"),
  ]);
  const tabs = (tabsData as { id: string; slug: string; title: I18n; is_default: boolean }[]) ?? [];
  const cities = (citiesData as City[]) ?? [];
  const { filters, q, city: citySlug, page, col: colSlug, sort } = readFilters(sp, settings);
  const city = cities.find((x) => x.slug === citySlug);
  // Tabs: "all" shows everything; with no choice, no search and no filter the
  // default tab opens. A search always spans every category.
  const showAll = colSlug === "all";
  const fallback = !colSlug && !q && Object.keys(filters).length === 0 ? tabs.find((x) => x.is_default)?.slug ?? "" : "";
  const collection = showAll ? null : await findCollection(supabase, colSlug || fallback, null);
  const col = collection?.slug ?? (showAll ? "all" : "");
  const isTab = !collection || tabs.some((x) => x.id === collection.id);
  const state = { q, city: city?.slug ?? "", col, sort, filters };
  const rr = getRules(locale);
  const ct = getCollectionTexts(locale);

  const [{ data, error }, groups] = await Promise.all([
    supabase.rpc("shop_search", {
      p_city: city?.id ?? null, p_query: q || null, p_filters: filters, p_collection: collection?.id ?? null,
      p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE, p_sort: sort || null,
    }),
    loadFilterGroups(supabase, settings, {
      locale, scope: "dorva", cityId: city?.id ?? null, q, filters, collectionId: collection?.id ?? null,
      valueLabel: (key, v) => (key === "type" ? t.dispensing[v] : undefined),
    }),
  ]);
  const items = (data as Item[]) ?? [];
  const total = items[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // anonymous search log for the dashboards (first page only, never blocks the page)
  if (q && page === 1 && !error) {
    await supabase.rpc("track_event", { p_kind: "search", p_query: q, p_results: total, p_city: city?.id ?? null }).then(() => null, () => null);
  }
  const keepCity = city ? `?city=${city.slug}` : "";
  const activeCount = Object.values(filters).reduce((n, v) => n + v.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {collection && !isTab ? (
            <>
              <p className="text-xs text-muted">
                <Link href={`/${locale}/products${city ? `?city=${city.slug}` : ""}`} className="hover:underline">{c.title}</Link>
                {" › "}{ct.collection}
              </p>
              <h1 className="mb-1 text-2xl font-extrabold">{titleOf(collection.title, locale)}</h1>
              {titleOf(collection.description, locale) && <p className="text-sm text-muted">{titleOf(collection.description, locale)}</p>}
            </>
          ) : (
            <>
              <h1 className="mb-1 text-2xl font-extrabold">{c.title}</h1>
              <p className="text-sm text-muted">{c.intro}</p>
            </>
          )}
        </div>
        {q && (
          <p className="text-sm">
            <span className="text-muted">{ft.search}: </span><b>«{q}»</b>
            <Link href={hrefWith(base, { ...state, q: "" })} className="ms-3 text-brand-700 hover:underline">{L.catalog.clearSearch}</Link>
          </p>
        )}
      </div>

      <div className={theme.grid.filters === "top" ? "space-y-4" : "grid gap-5 lg:grid-cols-[17rem_1fr]"}>
        <FacetSidebar
          action={base}
          groups={groups}
          q={q}
          city={city?.slug}
          col={col}
          sort={sort}
          cities={cities.map((x) => ({ value: x.slug, label: localized(x.name_fa, x.name_i18n, locale) }))}
          texts={sidebarTexts(locale)}
          locale={locale}
          activeCount={activeCount}
          top={theme.grid.filters === "top"}
        />

        <section className="min-w-0 space-y-4">
          <AddedBar show={!!sp.added} locale={locale} text={ct.addedBar} cta={ct.goToCart} />
          {tabs.length > 0 && isTab && (
            <nav aria-label={c.title} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[{ slug: "all", label: ct.tabAll }, ...tabs.map((x) => ({ slug: x.slug, label: titleOf(x.title, locale) }))].map((x) => {
                const active = x.slug === "all" ? !collection : collection?.slug === x.slug;
                return (
                  <Link key={x.slug} href={hrefWith(base, { q, city: state.city, sort, col: x.slug, filters: {} })}
                    aria-current={active ? "page" : undefined}
                    className={`chip shrink-0 whitespace-nowrap px-4 py-2 text-sm ${active ? "bg-brand-700 font-bold text-white" : "hover:bg-brand-100"}`}>
                    {x.label}
                  </Link>
                );
              })}
            </nav>
          )}
          <ActiveFilters base={base} state={state} groups={groups} texts={ft} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {ft.found(fmt(total))}
              {!city && <span className="ms-2 text-amber-800">{c.pickCity}</span>}
            </p>
            <div className="flex items-center gap-2">
            {theme.grid.toggle && <ViewToggle current={view} labels={L.extra.view} />}
            <SortSelect label={ct.sortLabel} current={sort || "recommended"}
              options={SORTS.map((v) => ({ value: v, label: ct.sorts[v], href: hrefWith(base, { ...state, sort: v === "recommended" ? "" : v }) }))} />
            </div>
          </div>

          {error ? (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{ft.loadError}</p>
          ) : items.length === 0 ? (
            <div className="card space-y-3 text-muted">
              <p>{q && activeCount ? L.catalog.noResultsBoth(q) : q ? L.catalog.noResultsQuery(q) : activeCount ? L.catalog.noResultsFilters : ft.noResults}</p>
              <div className="flex flex-wrap gap-2">
                {q && <Link href={hrefWith(base, { ...state, q: "" })} className="btn-ghost text-sm">{L.catalog.clearSearch}</Link>}
                {activeCount > 0 && <Link href={hrefWith(base, { ...state, filters: {} })} className="btn-ghost text-sm">{ft.clearAll}</Link>}
              </div>
            </div>
          ) : (
            <div className={view === "list" ? "space-y-2" : gridClass(theme.grid)}>
              {items.map((p) => (
                <ProductCard key={p.product_id} item={p} locale={locale} card={theme.card} view={view}
                  href={`/${locale}/product/${p.product_id}${keepCity}`} back={hrefWith(base, { ...state, page })} texts={cardTexts(locale)} />
              ))}
            </div>
          )}
          <Pager base={base} state={state} page={page} pages={pages} texts={ft} fmt={fmt} first={L.catalog.first} last={L.catalog.last} />
        </section>
      </div>
    </div>
  );
}
