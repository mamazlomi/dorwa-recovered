import { jsonLd, loadSeo, pageMeta, SITE_URL } from "@/lib/seo";
import { catPath } from "@/lib/catNames";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { CollectionRows } from "@/components/CollectionRows";
import { AddedBar } from "@/components/QuickAdd";
import { FilterBar } from "@/components/FilterBar";
import { ProductImage } from "@/components/ProductImage";
import { QtyStepper } from "@/components/QtyStepper";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { ViewPing } from "@/components/ViewPing";
import { formatMoney, formatNumber, localized, resolveLocale } from "@/i18n";
import { getCatalogTexts } from "@/i18n/dictionaries/catalog";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import { getRules } from "@/i18n/dictionaries/rules";
import { readAddress } from "@/lib/address";
import { isUuid, readCart, readLocation } from "@/lib/cart";
import { getFixTexts } from "@/i18n/dictionaries/fixes";
import type { FeaturedGroup, FeaturedItem } from "@/lib/collections";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";
import { addToCart } from "../../cart/actions";
import { FavoriteButton } from "@/components/FavoriteButton";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { loadTheme } from "@/lib/theme";
import { CatalogDetail, catalogRows, type CatalogData } from "@/components/CatalogDetail";
import { getCatalogSyncTexts } from "@/i18n/dictionaries/catalogSync";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type City = { id: number; slug: string; name_fa: string; name_i18n: I18n };
type Product = {
  id: string; name_fa: string; name_i18n: I18n; generic_name: string | null; dispensing_class: string;
  category_path: string[]; facets: Record<string, string[] | string> | null; image_url: string | null;
  detail: CatalogData | null; complete: boolean | null;
};
type FacetValue = { facet_key: string; value_code: string; name_fa: string; name_i18n: I18n };
type Offer = {
  pharmacy_id: string; slug: string; name_fa: string; name_i18n: I18n; city_fa: string | null; city_i18n: I18n | null;
  district_fa: string | null; district_i18n: I18n | null; final_price: number; list_price: number;
  discount_pct: number; max_qty: number; distance_km: number | null; delivery: "today" | "tomorrow" | "out" | null;
};
type Similar = {
  kind: "generic" | "section" | "complement"; product_id: string; name_fa: string; name_i18n: I18n; dispensing_class: string;
  category_path: string[]; image_url: string | null; min_price: number | null; max_price: number | null;
  max_discount: number | null; pharmacies: number;
};
type Params = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ city?: string; added?: string; capped?: string }> };

async function loadProduct(id: string) {
  if (!isUuid(id)) return { supabase: null, product: null };
  const supabase = await createClient();
  const { data } = await supabase.from("catalog_products")
    .select("id, name_fa, name_i18n, generic_name, dispensing_class, category_path, facets, image_url, detail, complete")
    .eq("id", id).eq("is_active", true).maybeSingle();
  return { supabase, product: data as Product | null };
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale } = await resolveLocale(params);
  const { id } = await params;
  const { product } = await loadProduct(id);
  if (!product) return { title: getCatalogTexts(locale).title, robots: { index: false } };
  const name = localized(product.name_fa, product.name_i18n, locale);
  const cat = await catPath(product.category_path, locale);
  const seo = await loadSeo(`/product/${product.id}`);
  const SEO_TEXT: Record<string, string> = {
    fa: "خرید آنلاین از داروخانه‌های معتبر نزدیک شما با تأیید داروساز در دوروا.",
    en: "Buy online from licensed pharmacies near you, checked by a pharmacist, on Dorva.",
    ar: "اشترِ عبر الإنترنت من صيدليات مرخّصة قريبة منك مع مراجعة الصيدلي على دوروا.",
  };
  return pageMeta({
    locale, path: `/product/${product.id}`, title: name,
    description: (locale === "fa" && product.detail?.texts?.short_description
      ? product.detail.texts.short_description.slice(0, 220) + " "
      : [name, product.generic_name, cat].filter(Boolean).join(" — ") + ". ") + (SEO_TEXT[locale] ?? SEO_TEXT.fa),
    image: product.image_url,
    // public advertising of prescription medicines is not allowed: such pages stay out of search engines
    noindex: product.dispensing_class === "rx" && !seo.index_rx,
  });
}

const DELIVERY_CLASS: Record<string, string> = {
  today: "bg-brand-50 text-brand-700", tomorrow: "bg-slate-100 text-slate-700", out: "bg-amber-50 text-amber-800",
};

export default async function ProductPage({ params, searchParams }: Params) {
  const { locale, t } = await resolveLocale(params);
  const c = getCatalogTexts(locale);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, product } = await loadProduct(id);
  if (!supabase || !product) notFound();

  const [{ data: citiesData }, loc, addr, { data: badgeSetting }, { data: extrasData }] = await Promise.all([
    supabase.from("cities").select("id, slug, name_fa, name_i18n").order("id"),
    readLocation(),
    readAddress(),
    supabase.from("settings").select("value").eq("key", "catalog.incomplete_badge").eq("scope", "platform").maybeSingle(),
    supabase.rpc("product_extras", { p_ids: [product.id] }),
  ]);
  const extras = ((extrasData as Record<string, { badge?: { label: Record<string, string>; tone: string }; max_per_order?: number }> | null) ?? {})[product.id] ?? {};
  const TONES: Record<string, string> = { brand: "bg-brand-50 text-brand-700", accent: "bg-accent-50 text-accent-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700", gray: "bg-gray-100 text-gray-700" };
  const CS = getCatalogSyncTexts(locale);
  const showIncomplete = product.complete === false && (badgeSetting?.value ?? true) !== false;
  const cities = (citiesData as City[]) ?? [];
  // an explicit ?city wins; otherwise the city of the delivery address
  const city = cities.find((x) => x.slug === sp.city) ?? (sp.city === undefined ? cities.find((x) => x.slug === addr?.city) : undefined);

  const facetCodes = Object.entries(product.facets ?? {})
    .filter(([k]) => k in c.facetLabels)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((code) => ({ k, code })));
  const [{ data: offersData }, { data: facetData }, { data: similarData }, { user }] = await Promise.all([
    supabase.rpc("product_offers_v2", { p_product: product.id, p_city: city?.id ?? null, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null }),
    facetCodes.length
      ? supabase.from("catalog_facet_values").select("*").in("value_code", facetCodes.map((f) => f.code))
      : Promise.resolve({ data: [] }),
    supabase.rpc("product_similar", { p_product: product.id, p_city: city?.id ?? null }),
    getUser(),
  ]);
  const { data: compData } = await supabase.rpc("product_complements_for", {
    p_product: product.id, p_city: city?.id ?? null, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null,
  });
  const { data: favData } = user
    ? await supabase.from("favorites").select("product_id").eq("product_id", product.id).maybeSingle()
    : { data: null };
  const isFav = !!favData;
  const theme = await loadTheme();
  const L = getLookTexts(locale);
  const ct = getCollectionTexts(locale);
  const r = getRules(locale);
  const fmt = (n: number) => formatNumber(n, locale);
  const offers = (offersData as Offer[]) ?? [];
  const facetName = new Map(((facetData as FacetValue[]) ?? []).map((f) => [`${f.facet_key}|${f.value_code}`, localized(f.name_fa, f.name_i18n, locale)]));
  const name = localized(product.name_fa, product.name_i18n, locale);
  // the basket already holds some: buying more is capped at the stock left
  const inCart = (await readCart()).items.find((l) => l.p === product.id)?.q ?? 0;
  const X = getFixTexts(locale);
  const left = (o: Offer) => Math.max(Math.min(o.max_qty, extras.max_per_order ?? 999) - inCart, 0);
  const bestLeft = Math.max(0, ...offers.map(left));
  const isRx = product.dispensing_class === "rx";
  const minP = offers.length ? Math.min(...offers.map((o) => Number(o.final_price))) : null;
  const maxP = offers.length ? Math.max(...offers.map((o) => Number(o.final_price))) : null;
  const here = `/${locale}/product/${product.id}${city ? `?city=${city.slug}` : ""}`;
  const place = (o: Offer) => [
    !city && o.city_fa ? localized(o.city_fa, o.city_i18n, locale) : null,
    o.district_fa ? localized(o.district_fa, o.district_i18n, locale) : null,
  ].filter(Boolean).join(" — ");

  const catLabel = await catPath(product.category_path, locale);
  // specification rows: active ingredient, type, category, then catalog facets
  const specs: [string, string][] = [
    ...(product.generic_name ? [[c.generic, product.generic_name] as [string, string]] : []),
    [c.typeLabel, t.dispensing[product.dispensing_class] ?? product.dispensing_class],
    ...(product.category_path.length ? [[c.category, catLabel] as [string, string]] : []),
    ...Object.keys(c.facetLabels).flatMap((k) => {
      const vals = facetCodes.filter((f) => f.k === k).map((f) => facetName.get(`${f.k}|${f.code}`) ?? f.code);
      return vals.length ? [[c.facetLabels[k], vals.join("، ")] as [string, string]] : [];
    }),
    // catalog layer extras; only values that exist, so a missing field shows no row at all
    ...catalogRows(product.detail, CS, locale, Object.keys(c.facetLabels)),
  ];

  // similar products shown with the same row component as the home page
  const similar = [...((compData as Similar[]) ?? []), ...((similarData as Similar[]) ?? [])];
  const rowTitle = (kind: Similar["kind"]) =>
    kind === "complement" ? getLogisticsTexts(locale).rowTitle : kind === "generic" ? c.similarGeneric : c.similarSection;
  const groups: FeaturedGroup[] = (["complement", "generic", "section"] as const)
    .map((kind) => {
      const items = similar.filter((s) => s.kind === kind).map((s) => ({
        ...s, collection_id: kind, slug: kind, title: {}, sort: 0, list_price: null, total: 0,
      }) as FeaturedItem);
      return { id: kind, slug: kind, title: { [locale]: rowTitle(kind), fa: rowTitle(kind) }, total: items.length, items };
    })
    .filter((g) => g.items.length > 0);

  const P = theme.product;
  const buyForm = (o: Offer, cls: string) => !isRx && o.delivery !== "out" && left(o) > 0 && (
    <form action={addToCart}>
      <input type="hidden" name="product_id" value={product.id} />
      <input type="hidden" name="pharmacy_id" value={o.pharmacy_id} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={here} />
      <input type="hidden" name="qty" value="1" />
      <SubmitButton className={cls} pendingLabel={r.adding}>{c.buyHere}</SubmitButton>
    </form>
  );
  const offerName = (o: Offer) => (
    <Link href={`/${locale}/${o.slug}?q=${encodeURIComponent(product.name_fa)}#p-${product.id}`} className="font-medium hover:underline">{localized(o.name_fa, o.name_i18n, locale)}</Link>
  );
  const offerMeta = (o: Offer) => (
    <>
      {place(o) && <span>{place(o)}</span>}
      {o.distance_km != null && <span>{c.km(fmt(Number(o.distance_km)))}</span>}
      {/* without a delivery address the estimate would be a guess, so none is shown */}
      {loc && o.delivery && <span className={`chip ${DELIVERY_CLASS[o.delivery]}`}>{c.delivery[o.delivery]}</span>}
      {left(o) > 0 && theme.lowStock > 0 && left(o) <= theme.lowStock && <span className="font-semibold text-amber-800">{L.product.onlyLeft(fmt(left(o)))}</span>}
    </>
  );
  const offerPrice = (o: Offer) => (
    <>
      {Number(o.discount_pct) > 0 && (
        <>
          <span className="text-xs text-muted line-through">{formatMoney(o.list_price, locale)}</span>
          <span className="chip bg-red-50 text-red-700">{r.discountOff(fmt(Number(o.discount_pct)))}</span>
        </>
      )}
      <span className="font-bold">{formatMoney(o.final_price, locale)}</span>
    </>
  );
  const offersBox = offers.length > 0 && (
    <section className="card space-y-2">
      <h2 className="font-bold">{c.offersTitle}</h2>
      <p className="text-xs text-muted">{isRx ? c.rxOffers : loc ? `${c.offersNote} ${c.deliveryNote}` : c.offersNote}</p>
      {P.offers === "cards" ? (
        <ul className="grid gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((o) => (
            <li key={o.pharmacy_id} className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
              {offerName(o)}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">{offerMeta(o)}</div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="flex flex-wrap items-center gap-2">{offerPrice(o)}</span>
                {buyForm(o, "btn py-1.5 text-xs")}
              </div>
            </li>
          ))}
        </ul>
      ) : P.offers === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <tbody>
              {offers.map((o) => (
                <tr key={o.pharmacy_id} className="border-t border-line first:border-t-0">
                  <td className="py-2.5 pe-3">{offerName(o)}</td>
                  <td className="py-2.5 pe-3"><span className="flex flex-wrap items-center gap-2 text-xs text-muted">{offerMeta(o)}</span></td>
                  <td className="whitespace-nowrap py-2.5 pe-3 text-end"><span className="inline-flex flex-wrap items-center gap-2">{offerPrice(o)}</span></td>
                  <td className="py-2.5 text-end">{buyForm(o, "btn-ghost py-1.5 text-xs")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {offers.map((o) => (
            <li key={o.pharmacy_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 space-y-1">
                {offerName(o)}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">{offerMeta(o)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {offerPrice(o)}
                {buyForm(o, "btn-ghost py-1.5 text-xs")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const specsBox = specs.length > 0 && (
    <section className="card space-y-2">
      <h2 className="font-bold">{c.specs}</h2>
      <table className="w-full text-sm">
        <tbody>
          {specs.map(([k, v]) => (
            <tr key={k} className="border-t border-line first:border-t-0">
              <th scope="row" className="w-40 py-2 pe-3 text-start font-medium text-muted">{k}</th>
              <td className="py-2" dir="auto">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
  const LAYOUT = {
    side: "card grid gap-5 md:grid-cols-[minmax(0,260px)_1fr]",
    stacked: "card grid gap-5",
    compact: "card grid gap-5 grid-cols-[96px_1fr] md:grid-cols-[150px_1fr]",
  } as const;
  const imgBox = P.layout === "stacked" ? "mx-auto w-full max-w-sm" : "self-start";

  const brandCode = Array.isArray(product.facets?.brand) ? product.facets?.brand[0] : (product.facets?.brand as string | undefined);
  const ld = {
    "@context": "https://schema.org", "@graph": [
      {
        "@type": "Product", name, image: product.image_url ?? undefined, category: catLabel || undefined,
        ...(product.generic_name ? { description: product.generic_name } : {}),
        ...(brandCode ? { brand: { "@type": "Brand", name: facetName.get(`brand|${brandCode}`) ?? brandCode } } : {}),
        // no offers in structured data for prescription medicines
        ...(!isRx && minP != null ? { offers: { "@type": "AggregateOffer", priceCurrency: "IRR", lowPrice: minP, highPrice: maxP ?? minP, offerCount: offers.length,
          availability: "https://schema.org/InStock" } } : {}),
      },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: t.brand, item: `${SITE_URL}/${locale}` },
        { "@type": "ListItem", position: 2, name: c.title, item: `${SITE_URL}/${locale}/products` },
        { "@type": "ListItem", position: 3, name, item: `${SITE_URL}/${locale}/product/${product.id}` },
      ] },
    ],
  };
  return (
    <div className="space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ViewPing id={product.id} />
      {sp.added === product.id && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <span>{t.cart.added} — {name}{sp.capped === "1" && <> · <b className="text-amber-800">{X.capped}</b></>}</span>
          <Link href={`/${locale}/cart`} className="btn">{t.cart.goToCart}</Link>
        </div>
      )}
      <AddedBar show={!!sp.added && sp.added !== product.id} locale={locale} text={ct.addedBar} cta={ct.goToCart} />
      <Link href={`/${locale}/products${city ? `?city=${city.slug}` : ""}`} className="text-sm text-brand-700 hover:underline">{c.backToList}</Link>

      <section className={LAYOUT[P.layout as keyof typeof LAYOUT] ?? LAYOUT.side}>
        <div className={imgBox}><ProductImage id={product.id} name={name} section={product.category_path[0]} imageUrl={product.image_url} /></div>
        <div className="space-y-3">
          <p className="text-xs text-muted">{catLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold">{name}</h1>
            <span className="chip">{t.dispensing[product.dispensing_class]}</span>
            <FavoriteButton productId={product.id} initial={isFav} signedIn={!!user}
              loginHref={`/${locale}/login?next=${encodeURIComponent(here)}`}
              labels={{ add: ct.favAdd, remove: ct.favRemove, login: ct.favLogin }} />
          </div>
          {product.generic_name && <p className="text-sm text-muted">{c.generic}: <span dir="ltr">{product.generic_name}</span></p>}
          {locale === "fa" && product.detail?.texts?.short_description && <p className="whitespace-pre-line text-sm leading-7">{product.detail.texts.short_description}</p>}
          {extras.badge && <p className={`chip font-semibold ${TONES[extras.badge.tone] ?? TONES.brand}`}>{extras.badge.label[locale] ?? extras.badge.label.fa}</p>}
          {showIncomplete && <p className="chip bg-amber-50 text-amber-800">{CS.incompleteBadge}</p>}

          {minP != null ? (
            <div>
              <p className="text-lg font-bold">
                {minP === maxP
                  ? <span className="whitespace-nowrap">{formatMoney(minP, locale)}</span>
                  : <><span className="whitespace-nowrap">{formatMoney(minP, locale)}</span> <span className="font-normal text-muted">{c.rangeTo}</span> <span className="whitespace-nowrap">{formatMoney(maxP, locale)}</span></>}
              </p>
              <p className="text-sm text-muted">{c.inPharmacies(fmt(offers.length))}</p>
            </div>
          ) : (
            <p className="text-muted">{c.notAvailable}</p>
          )}

          {isRx ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.pharmacy.rxNote}</p>
          ) : offers.length > 0 && (
            <div className="space-y-2">
              {inCart > 0 && <p className="text-sm font-semibold text-brand-700">{bestLeft > 0 ? X.inCart(fmt(inCart)) : X.allInCart}</p>}
              {bestLeft > 0 && <form action={addToCart} className="flex max-w-md items-center gap-2">
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="back" value={here} />
                <QtyStepper name="qty" locale={locale} max={Math.min(bestLeft, 10)} decLabel={t.cart.dec} incLabel={t.cart.inc} />
                <SubmitButton className="btn min-w-0 flex-1 whitespace-nowrap text-sm" pendingLabel={r.adding}>{c.addDorva}</SubmitButton>
              </form>}
              <p className="text-xs text-muted">{c.dorvaNote}</p>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <div className="max-w-xs flex-1">
              <FilterBar action={`/${locale}/product/${product.id}`} values={{ city: city?.slug }} compact
                applyLabel={t.filters.apply} clearLabel={t.filters.clear}
                fields={[{ type: "select", name: "city", label: c.city, emptyLabel: c.allCities,
                  options: cities.map((x) => ({ value: x.slug, label: localized(x.name_fa, x.name_i18n, locale) })) }]} />
            </div>
            <AddressChip locale={locale} address={addr} back={here} guest={!user} />
          </div>
          {!loc && <p className="text-xs text-muted">{c.locationHint}</p>}
        </div>
      </section>

      {P.specs === "before" && specsBox}
      {offersBox}
      {P.specs !== "before" && specsBox}
      <CatalogDetail data={product.detail} texts={CS} locale={locale} />

      <CollectionRows groups={groups} locale={locale} seeAllBase={`/${locale}/products`} showAll={false}
        productQuery={city ? `?city=${city.slug}` : ""} back={here} />
      {groups.some((g) => g.id === "section") && <p className="text-xs text-muted">{c.similarSection}: {L.product.similarBasis}</p>}

      {/* phones: price and "add" stay at the bottom of the screen */}
      {P.stickyBuy && !isRx && offers.length > 0 && minP != null && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 p-3 backdrop-blur md:hidden">
          <form action={addToCart} className="flex items-center justify-between gap-3">
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="qty" value="1" />
            <span className="min-w-0 truncate text-sm font-bold">{minP === maxP ? formatMoney(minP, locale) : c.from(formatMoney(minP, locale))}</span>
            <SubmitButton className="btn shrink-0" pendingLabel={r.adding}>{c.addDorva}</SubmitButton>
          </form>
        </div>
      )}
      {P.stickyBuy && !isRx && offers.length > 0 && <div className="h-16 md:hidden" aria-hidden />}
    </div>
  );
}
