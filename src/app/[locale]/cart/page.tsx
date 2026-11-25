import type { Metadata } from "next";
import Link from "next/link";
import { AddressChip } from "@/components/AddressChip";
import { PlanParts } from "@/components/PlanParts";
import { getFixTexts } from "@/i18n/dictionaries/fixes";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { loadTheme } from "@/lib/theme";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { readAddress } from "@/lib/address";
import type { Plan, PlanItem } from "@/lib/plan";
import { FilterBar } from "@/components/FilterBar";
import { SubmitButton } from "@/components/SubmitButton";
import { SetupNotice } from "@/components/SetupNotice";
import { formatMoney, formatNumber, getDictionary, isLocale, localized, resolveLocale } from "@/i18n";
import { getRules } from "@/i18n/dictionaries/rules";
import { isUuid, readCart, readLocation, toRpcItems } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { getUser } from "@/lib/supabase/server";
import { removeLines, setQty } from "./actions";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Params = { params: Promise<{ locale: string }>; searchParams: Promise<{ city?: string; ph?: string }> };
type Product = { id: string; name_fa: string; name_i18n: I18n; dispensing_class: string };
type City = { id: number; slug: string; name_fa: string; name_i18n: I18n };
type Candidate = {
  pharmacy_id: string; slug: string; name_fa: string; name_i18n: I18n;
  distance_km: number | null; covered: number; total: number; subtotal: number;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: getDictionary(isLocale(locale) ? locale : "fa").cart.title, robots: { index: false } };
}

export default async function CartPage({ params, searchParams }: Params) {
  const { locale, t } = await resolveLocale(params);
  const c = t.cart;
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;

  const sp = await searchParams;
  const cart = await readCart();
  const here = `/${locale}/cart`;

  if (cart.items.length === 0) {
    return (
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <h1 className="text-xl font-bold">{c.title}</h1>
        <p className="text-muted">{c.empty}</p>
        <Link href={`/${locale}`} className="btn">{c.browse}</Link>
      </div>
    );
  }

  const { supabase, user } = await getUser();
  const loc = await readLocation();
  const addr = await readAddress();
  const ids = cart.items.map((l) => l.p);

  const [{ data: productsData }, { data: citiesData }, { data: prefData }] = await Promise.all([
    supabase.from("catalog_products").select("id, name_fa, name_i18n, dispensing_class").in("id", ids),
    supabase.from("cities").select("id, slug, name_fa, name_i18n").order("id"),
    cart.pref
      ? supabase.from("pharmacies").select("city_id").eq("id", cart.pref).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const products = new Map(((productsData as Product[]) ?? []).map((p) => [p.id, p]));
  const cities = (citiesData as City[]) ?? [];
  const prefCity = (prefData as { city_id: number } | null)?.city_id;
  const city =
    cities.find((x) => x.slug === sp.city) ??
    cities.find((x) => x.slug === addr?.city) ??
    cities.find((x) => x.id === prefCity) ??
    cities.find((x) => x.slug === "tehran") ??
    cities[0];
  const force = isUuid(sp.ph) ? sp.ph : null;

  const rpcArgs = { p_items: toRpcItems(cart), p_city: city?.id ?? null, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null };
  const [{ data: planData, error: planError }, { data: candData }] = await Promise.all([
    supabase.rpc("plan_cart_v2", { ...rpcArgs, p_preferred: cart.pref ?? null, p_force: force }),
    supabase.rpc("cart_candidates", { ...rpcArgs, p_limit: 6 }),
  ]);
  const plan = planData as Plan | null;
  const candidates = (candData as Candidate[]) ?? [];
  const chosenIds = new Set((plan?.pharmacies ?? []).map((p) => p.pharmacy_id));

  const assigned = new Map<string, { item: PlanItem; n: number }>();
  (plan?.pharmacies ?? []).forEach((ph, i) => ph.items.forEach((it) => assigned.set(it.product_id, { item: it, n: i + 1 })));
  const name = (id: string) => {
    const p = products.get(id);
    return p ? localized(p.name_fa, p.name_i18n, locale) : "—";
  };
  const r = getRules(locale);
  const theme = await loadTheme();
  const o = getOrderTexts(locale);
  const sep = locale === "en" ? ", " : "، ";
  const hasTech = cart.items.some((l) => ["otc", "supplement"].includes(products.get(l.p)?.dispensing_class ?? ""));
  const keep = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (city) q.set("city", city.slug);
    Object.entries(extra).forEach(([k, v]) => v && q.set(k, v));
    return `${here}?${q.toString()}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">{c.title}</h1>

      <div className={theme.cart.summary === "bottom" ? "mx-auto grid max-w-3xl gap-6" : "grid gap-6 lg:grid-cols-[3fr_2fr]"}>
        {/* ---------- items ---------- */}
        <section className="card space-y-1">
          <h2 className="mb-2 font-bold">{c.yourItems}</h2>
          <ul className="divide-y divide-line">
            {cart.items.map((l) => {
              const p = products.get(l.p);
              const a = assigned.get(l.p);
              return (
                <li key={l.p} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/${locale}/product/${l.p}${city ? `?city=${city.slug}` : ""}`} className="font-medium hover:text-brand-700 hover:underline">{name(l.p)}</Link>
                    <p className="text-xs text-muted">
                      {p ? t.dispensing[p.dispensing_class as keyof typeof t.dispensing] : ""}
                      {a && plan && plan.pharmacies.length > 1 ? ` · ${c.pharmacyN(formatNumber(a.n, locale))}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {a && (
                      <span className="text-end leading-tight">
                        <span className="block text-sm font-semibold">{formatMoney(a.item.line_total, locale)}</span>
                        {l.q > 1 && (
                          <span className="block text-xs text-muted">
                            {r.unitTimes(formatMoney(a.item.unit_price, locale), formatNumber(l.q, locale))}
                          </span>
                        )}
                      </span>
                    )}
                    <form action={setQty}>
                      <input type="hidden" name="product_id" value={l.p} />
                      <input type="hidden" name="qty" value={l.q - 1} />
                      <SubmitButton className="btn-ghost px-3" ariaLabel={c.dec}>−</SubmitButton>
                    </form>
                    <span className="w-6 text-center">{formatNumber(l.q, locale)}</span>
                    <form action={setQty}>
                      <input type="hidden" name="product_id" value={l.p} />
                      <input type="hidden" name="qty" value={l.q + 1} />
                      <SubmitButton className="btn-ghost px-3" ariaLabel={c.inc}>+</SubmitButton>
                    </form>
                    <form action={setQty}>
                      <input type="hidden" name="product_id" value={l.p} />
                      <input type="hidden" name="qty" value={0} />
                      <SubmitButton className="text-xs text-red-700 hover:underline" pendingLabel={r.updating}>{c.remove}</SubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>

          {plan && plan.needs_prescription.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-1">{c.rxNotice}</p>
              <p className="font-medium">{plan.needs_prescription.map(name).join(sep)}</p>
            </div>
          )}
          {plan && plan.unavailable.length > 0 && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
              {/* when other cities can send them, say so instead of "not available" */}
              <p className="mb-1">{(plan.intercity_options?.length ?? 0) > 0 ? getLookTexts(locale).cartPage.notInCity : c.unavailableNotice}</p>
              <p className="mb-2 font-medium">{plan.unavailable.map(name).join(sep)}</p>
              {(() => {
                // the cheapest-to-reach other city, offered as one click (never chosen silently:
                // intercity shipping costs more and takes longer)
                const best = plan.intercity_options?.[0];
                if (!best) return null;
                const X = getFixTexts(locale);
                const bestCity = best.city_fa ? localized(best.city_fa, best.city_i18n ?? {}, locale) : localized(best.name_fa, best.name_i18n, locale);
                return (
                  <div className="mb-2 space-y-2 rounded-lg bg-white/70 p-2 text-ink">
                    <p>{X.otherCityBody(bestCity, formatMoney(best.shipping, locale), o.eta.days(formatNumber(best.min_days, locale), formatNumber(best.max_days, locale)))}</p>
                    <Link href={keep({ ph: best.pharmacy_id })} className="btn inline-block text-sm">{X.otherCityBtn(bestCity)}</Link>
                  </div>
                );
              })()}
              <form action={removeLines}>
                <input type="hidden" name="ids" value={plan.unavailable.join(",")} />
                <SubmitButton className="btn-ghost text-xs">{c.removeUnavailable}</SubmitButton>
              </form>
            </div>
          )}
        </section>

        {/* ---------- location + plan ---------- */}
        <div className="space-y-4">
          <section className="card space-y-3">
            <h2 className="font-bold">{c.locationTitle}</h2>
            <FilterBar
              action={here}
              values={{ city: city?.slug }}
              applyLabel={t.filters.apply}
              clearLabel={t.filters.clear}
              compact
              fields={[{ type: "select", name: "city", label: c.city,
                options: cities.map((x) => ({ value: x.slug, label: localized(x.name_fa, x.name_i18n, locale) })) }]}
            />
            <AddressChip locale={locale} address={addr} back={here} guest={!user} />
            {!loc && <p className="text-xs text-muted">{c.locationOff}</p>}
          </section>

          <section className="card space-y-3">
            <h2 className="font-bold">{c.planTitle}</h2>
            {planError && <p className="text-sm text-red-700">{t.dashboard.errors.unknown}</p>}
            {plan && (
              <>
                <p className="text-sm text-muted">
                  {plan.strategy === "single" && !plan.has_location && city
                    ? r.singleNoLocation(localized(city.name_fa, city.name_i18n, locale))
                    : plan.strategy === "preferred"
                      ? r.preferredPlan
                      : c.strategy[plan.strategy]}
                  {plan.radius_km ? ` (${c.radius(formatNumber(plan.radius_km, locale))})` : ""}
                </p>
                {plan.strategy === "single" && plan.band_size > 1 && plan.tiebreak !== "nearest" && (
                  <p className="text-xs text-muted">
                    {plan.has_location || !city
                      ? r.fairNote(formatNumber(plan.band_size, locale))
                      : r.fairNoteCity(formatNumber(plan.band_size, locale), localized(city.name_fa, city.name_i18n, locale))}
                  </p>
                )}
                {cart.pref && !force && plan.strategy !== "preferred" && !chosenIds.has(cart.pref) && plan.pharmacies.length > 0 && (
                  <p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">{r.prefShort}</p>
                )}
                {plan.strategy === "intercity" && (
                  <p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">{o.intercityChosen}</p>
                )}
                <PlanParts plan={plan} locale={locale} name={name} subtotalLabel={c.subtotal} totalLabel={o.grandTotal} />
                {plan.pharmacies.length > 0 && (
                  <>
                    {hasTech && <p className="text-xs text-muted">{c.techNote}</p>}
                    {!user ? (
                      <>
                        <Link href={`/${locale}/login?next=${encodeURIComponent(keep({ ph: force ?? undefined }))}`} className="btn w-full text-center">
                          {o.loginToContinue}
                        </Link>
                        <p className="text-xs text-muted">{o.guestNote}</p>
                      </>
                    ) : !addr ? (
                      <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                        <p>{r.locationRequired}</p>
                        <AddressChip locale={locale} address={null} back={here} />
                      </div>
                    ) : (
                      <Link href={`/${locale}/checkout${force ? `?ph=${force}` : ""}`} className="btn w-full text-center">{o.continue}</Link>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          {(plan?.intercity_options?.length ?? 0) > 0 && plan && (
            <section className="card space-y-2">
              <h2 className="font-bold">{o.intercityTitle}</h2>
              <p className="text-xs text-muted">{o.intercityIntro}</p>
              <ul className="divide-y divide-line">
                {plan.intercity_options.map((x) => (
                  <li key={x.pharmacy_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{localized(x.name_fa, x.name_i18n, locale)}</p>
                      <p className="text-xs text-muted">
                        {o.intercityRow(x.city_fa ? localized(x.city_fa, x.city_i18n ?? {}, locale) : "", formatNumber(Number(x.distance_km), locale))}
                        {` · ${o.covers(formatNumber(x.covered, locale), formatNumber(x.total, locale))}`}
                      </p>
                      <p className="text-xs text-muted">
                        {formatMoney(x.subtotal, locale)} + {o.shipping} {formatMoney(x.shipping, locale)}
                        {` · ${o.eta.days(formatNumber(x.min_days, locale), formatNumber(x.max_days, locale))}`}
                      </p>
                    </div>
                    <Link href={keep({ ph: x.pharmacy_id })} className="btn-ghost text-xs">{o.chooseThis}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {candidates.length > 0 && (
            <section className="card space-y-2">
              <h2 className="font-bold">{c.alternativesTitle}</h2>
              <ul className="divide-y divide-line">
                {candidates.map((x) => {
                  const isCurrent = force === x.pharmacy_id || (!force && chosenIds.size === 1 && chosenIds.has(x.pharmacy_id));
                  return (
                    <li key={x.pharmacy_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div>
                        <p className="font-medium">{localized(x.name_fa, x.name_i18n, locale)}</p>
                        <p className="text-xs text-muted">
                          {c.covers(formatNumber(x.covered, locale), formatNumber(x.total, locale))}
                          {x.distance_km != null ? ` · ${c.distance(formatNumber(x.distance_km, locale))}` : ""}
                          {` · ${formatMoney(x.subtotal, locale)}`}
                        </p>
                      </div>
                      {isCurrent ? (
                        <span className="chip">{c.current}</span>
                      ) : (
                        <Link href={keep({ ph: x.pharmacy_id })} className="btn-ghost text-xs">{c.choose}</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              {force && <Link href={keep({})} className="text-sm text-brand-700 hover:underline">{c.auto}</Link>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
