import Link from "next/link";
import { formatMoney, formatNumber, localized, type Locale } from "@/i18n";
import { getCatalogTexts } from "@/i18n/dictionaries/catalog";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import type { Plan } from "@/lib/plan";

// Pharmacies of a cart plan with their items, shipping and delivery estimate,
// followed by the totals. Shared by the cart and the checkout page.
export function PlanParts({ plan, locale, name, subtotalLabel, totalLabel }: {
  plan: Plan; locale: Locale; name: (id: string) => string; subtotalLabel: string; totalLabel: string;
}) {
  const o = getOrderTexts(locale);
  const lg = getLogisticsTexts(locale);
  const fmt = (n: number) => formatNumber(n, locale);
  const sep = locale === "en" ? ", " : "، ";
  const money = (n: number) => (Number(n) === 0 ? o.free : formatMoney(n, locale));
  return (
    <div className="space-y-3">
      {plan.pharmacies.map((ph, i) => (
        <div key={ph.pharmacy_id} className="space-y-1 rounded-xl border border-line p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/${locale}/${ph.slug}`} className="font-semibold hover:underline">
              {plan.pharmacies.length > 1 && `${fmt(i + 1)}. `}
              {localized(ph.name_fa, ph.name_i18n, locale)}
            </Link>
            <span className={`chip ${ph.kind === "intercity" ? "bg-amber-50 text-amber-800" : ""}`}>
              {ph.eta === "days" ? o.eta.days(fmt(ph.min_days), fmt(ph.max_days)) : o.eta[ph.eta]}
            </span>
          </div>
          <p className="text-xs text-muted">
            {ph.kind === "intercity" && ph.city_fa ? `${o.intercity}: ${localized(ph.city_fa, ph.city_i18n ?? {}, locale)} · ` : ""}
            {ph.distance_km != null ? getCatalogTexts(locale).km(fmt(Number(ph.distance_km))) : ""}
          </p>
          <p className="text-xs text-muted">{ph.items.map((it) => name(it.product_id)).join(sep)}</p>
          <div className="flex justify-between pt-1"><span>{subtotalLabel}</span><b>{formatMoney(ph.subtotal, locale)}</b></div>
          <div className="flex justify-between"><span>{o.shipping}{ph.provider === "pharmacy" ? ` (${lg.byPharmacy})` : ""}</span><span>{Number(ph.shipping_full ?? 0) > Number(ph.shipping) && <span className="me-2 text-xs text-muted line-through">{formatMoney(ph.shipping_full ?? 0, locale)}</span>}{money(ph.shipping)}</span></div>
        </div>
      ))}
      {plan.pharmacies.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="flex justify-between"><span>{o.itemsTotal}</span><span>{formatMoney(plan.total, locale)}</span></p>
          <p className="flex justify-between"><span>{o.shipping}</span><span>{money(plan.shipping_total)}</span></p>
          <p className="flex justify-between border-t border-line pt-2 text-lg font-bold">
            <span>{totalLabel}</span><span>{formatMoney(plan.grand_total, locale)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
