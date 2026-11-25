import Link from "next/link";
import type { ReactNode } from "react";
import { BarList, C, Columns, Heatmap, Legend, LineChart, Stats } from "@/components/charts";
import { DashboardGrid } from "@/components/DashboardGrid";
import { formatMoney, formatNumber, getDictionary, type Locale } from "@/i18n";
import { getDashboardTexts } from "@/i18n/dictionaries/dashboard";
import { getFinderTexts } from "@/i18n/dictionaries/finder";
import type { WidgetPos } from "@/lib/dashboardActions";

export type Metrics = {
  days: number;
  sales: { orders: number; parts: number; items_total: number; units: number; shipping: number; gross: number; avg_basket: number };
  finance: { held: number; released: number; refunded: number; dorva: number; pharmacy: number; logistics: number };
  ops: {
    tech_median_min: number | null; tech_reviewed: number; tech_rejected: number; cancelled: Record<string, number>;
    reassigned: number; delivered: number; delivery_hours: number | null; wrong_codes: number; pending_tech_now: number; overdue_now: number;
  };
  inventory: { lines: number; out: number; low: number; clipped: number };
  customers: { buyers: number; new: number; repeat: number };
  series: { d: string; orders: number; revenue: number; refunds: number }[];
  top_products: { name: string; units: number; revenue: number }[];
  top_categories: { name: string; units: number; revenue: number }[];
  top_pharmacies: { name: string; orders: number; revenue: number }[];
  cities: { name: string; orders: number }[];
  funnel: { views: number; cart_adds: number; ordered_units: number; orders: number };
  heat_orders: [number, number, number][];
  heat_views: [number, number, number][];
  taste: { name: string; viewed: number; bought: number }[];
  brands: { name: string; units: number }[];
  classes: Record<string, number>;
  searches: { q: string; n: number; results: number | null }[];
  no_results: { q: string; n: number }[];
};

export type FinderStats = {
  searches: number; views: number; calls: number; reports: number; listed: number; declared: number;
  pending_suggestions: number | null; demoted: number;
  top_drugs: { name: string; views: number; calls: number }[]; unmet: { q: string; n: number }[];
};

const PLATFORM_ONLY = new Set(["top_pharmacies", "cities", "searches", "no_results"]);
const DEFAULTS: WidgetPos[] = [
  { id: "sales", size: "m" }, { id: "finance", size: "m" },
  { id: "revenue", size: "l" }, { id: "orders", size: "m" }, { id: "ops", size: "m" },
  { id: "heat_orders", size: "l" }, { id: "funnel", size: "s" }, { id: "customers", size: "s" }, { id: "inventory", size: "s" },
  { id: "taste", size: "l" }, { id: "heat_views", size: "l" },
  { id: "top_products", size: "m" }, { id: "top_categories", size: "m" },
  { id: "brands", size: "s" }, { id: "classes", size: "s" }, { id: "top_pharmacies", size: "s" },
  { id: "cities", size: "s" }, { id: "searches", size: "s" }, { id: "no_results", size: "s" },
  { id: "finder", size: "m" },
];

// stored layout first (only known widgets), then any widget added since
export function mergeLayout(stored: unknown, platform: boolean): WidgetPos[] {
  const allowed = DEFAULTS.filter((w) => platform || !PLATFORM_ONLY.has(w.id));
  const known = new Map(allowed.map((w) => [w.id, w]));
  const out: WidgetPos[] = [];
  if (Array.isArray(stored)) {
    for (const s of stored as WidgetPos[]) if (s && known.has(s.id) && !out.some((o) => o.id === s.id)) out.push({ id: s.id, size: s.size ?? "m", hidden: !!s.hidden });
  }
  for (const w of allowed) if (!out.some((o) => o.id === w.id)) out.push(w);
  return out;
}

export function DashboardView({ locale, m, scope, layout, platform, periodHref, finder }: {
  locale: Locale; m: Metrics; scope: string; layout: WidgetPos[]; platform: boolean; periodHref: (days: number) => string;
  finder?: FinderStats | null;
}) {
  const D = getDashboardTexts(locale);
  const t = getDictionary(locale);
  const n = (v: number | null | undefined) => formatNumber(v ?? 0, locale);
  const money = (v: number) => formatMoney(v, locale);
  const compact = (v: number) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const dayFmt = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : locale === "ar" ? "ar" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const day = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
  const empty = <p className="text-sm text-muted">{D.noData}</p>;
  const pct = (a: number, b: number) => (b > 0 ? `${formatNumber(Math.round((a / b) * 1000) / 10, locale)}${locale === "en" ? "%" : "٪"}` : "—");

  const cancelled = Object.entries(m.ops.cancelled ?? {});
  const cancelTotal = cancelled.reduce((s, [, v]) => s + v, 0);
  const totalViewed = m.taste.reduce((s, r) => s + r.viewed, 0);
  const totalBought = m.taste.reduce((s, r) => s + r.bought, 0);
  const affinity = (r: { viewed: number; bought: number }) =>
    r.viewed > 0 && totalViewed > 0 && totalBought > 0 ? (r.bought / totalBought) / (r.viewed / totalViewed) : null;

  const w: Record<string, { title: string; node: ReactNode }> = {
    sales: { title: D.w.sales, node: <Stats items={[
      { label: D.k.orders, value: n(m.sales.orders) }, { label: D.k.gross, value: money(m.sales.gross) },
      { label: D.k.avg_basket, value: money(m.sales.avg_basket) }, { label: D.k.units, value: n(m.sales.units) },
      { label: D.k.shipping, value: money(m.sales.shipping) },
    ]} /> },
    finance: { title: D.w.finance, node: <Stats items={[
      { label: D.k.held, value: money(m.finance.held) }, { label: D.k.released, value: money(m.finance.released) },
      { label: D.k.refunded, value: money(m.finance.refunded) },
      ...(platform ? [{ label: D.k.dorva, value: money(m.finance.dorva) }] : []),
      { label: D.k.pharmacy, value: money(m.finance.pharmacy) }, { label: D.k.logistics, value: money(m.finance.logistics) },
    ]} /> },
    revenue: { title: D.w.revenue, node: m.series.some((s) => s.revenue > 0)
      ? <LineChart fmt={(v) => compact(v / 10)} points={m.series.map((s) => ({ label: day(s.d), value: s.revenue, title: `${day(s.d)}: ${money(s.revenue)}` }))} />
      : empty },
    orders: { title: D.w.orders, node: m.series.some((s) => s.orders > 0)
      ? <Columns fmt={(v) => n(Math.round(v))} points={m.series.map((s) => ({ label: day(s.d), value: s.orders, title: `${day(s.d)}: ${n(s.orders)} ${D.k.orders}` }))} />
      : empty },
    ops: { title: D.w.ops, node: (
      <div className="space-y-4">
        <Stats items={[
          { label: D.k.tech_median, value: m.ops.tech_median_min == null ? "—" : D.minutes(n(m.ops.tech_median_min)) },
          { label: D.k.tech_reject, value: pct(m.ops.tech_rejected, m.ops.tech_reviewed) },
          { label: D.k.delivered, value: n(m.ops.delivered) },
          { label: D.k.delivery_hours, value: m.ops.delivery_hours == null ? "—" : D.hours(n(m.ops.delivery_hours)) },
          { label: D.k.reassigned, value: n(m.ops.reassigned) },
          { label: D.k.wrong_codes, value: n(m.ops.wrong_codes), tone: m.ops.wrong_codes > 0 ? "warn" : undefined },
          { label: D.k.pending_now, value: n(m.ops.pending_tech_now) },
          { label: D.k.overdue_now, value: n(m.ops.overdue_now), tone: m.ops.overdue_now > 0 ? "bad" : undefined },
        ]} />
        {cancelTotal > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{D.cancelled} ({n(cancelTotal)})</h3>
            <BarList color={C.orange} rows={cancelled.map(([k, v]) => ({ label: D.cancelReason[k] ?? k, value: v, display: n(v) }))} />
          </div>
        )}
      </div>
    ) },
    inventory: { title: D.w.inventory, node: <Stats items={[
      { label: D.k.lines, value: n(m.inventory.lines) },
      { label: D.k.out, value: n(m.inventory.out), tone: m.inventory.out > 0 ? "warn" : undefined },
      { label: D.k.low, value: n(m.inventory.low) },
      { label: D.k.clipped, value: n(m.inventory.clipped), tone: m.inventory.clipped > 0 ? "warn" : undefined },
    ]} /> },
    customers: { title: D.w.customers, node: <Stats items={[
      { label: D.k.buyers, value: n(m.customers.buyers) }, { label: D.k.new, value: n(m.customers.new) },
      { label: D.k.repeat, value: n(m.customers.repeat) },
    ]} /> },
    funnel: { title: D.w.funnel, node: (
      <BarList rows={[
        { label: D.k.views, value: m.funnel.views, display: n(m.funnel.views) },
        { label: D.k.cart_adds, value: m.funnel.cart_adds, display: `${n(m.funnel.cart_adds)} · ${pct(m.funnel.cart_adds, m.funnel.views)}` },
        { label: D.k.ordered_units, value: m.funnel.ordered_units, display: `${n(m.funnel.ordered_units)} · ${pct(m.funnel.ordered_units, m.funnel.cart_adds)}` },
        { label: D.k.orders, value: m.funnel.orders, display: n(m.funnel.orders) },
      ]} />
    ) },
    heat_orders: { title: D.w.heat_orders, node: m.heat_orders.length
      ? <Heatmap cells={m.heat_orders} weekdays={D.weekdays} less={D.less} more={D.more} unit={(v) => `${n(v)} ${D.k.orders}`} /> : empty },
    heat_views: { title: D.w.heat_views, node: m.heat_views.length
      ? <Heatmap cells={m.heat_views} weekdays={D.weekdays} less={D.less} more={D.more} unit={(v) => `${n(v)} ${D.k.views}`} /> : empty },
    taste: { title: D.w.taste, node: m.taste.length ? (
      <div className="space-y-3">
        <Legend items={[{ label: D.viewed, color: C.blue }, { label: D.bought, color: C.teal }]} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="text-start text-xs text-muted">
              <th className="py-1 text-start font-medium" /><th className="w-1/2 py-1" />
              <th className="py-1 text-end font-medium" title={D.affinityHint}>{D.affinity} ⓘ</th>
            </tr></thead>
            <tbody>
              {m.taste.map((r) => {
                const a = affinity(r);
                const maxV = Math.max(1, ...m.taste.map((x) => x.viewed)), maxB = Math.max(1, ...m.taste.map((x) => x.bought));
                return (
                  <tr key={r.name} className="border-t border-line">
                    <td className="py-2 pe-2">{r.name}</td>
                    <td className="py-2">
                      <div className="space-y-1">
                        <div className="h-2 rounded-full" title={`${D.viewed}: ${n(r.viewed)}`} style={{ width: `${Math.max(1, (r.viewed / maxV) * 100)}%`, background: C.blue }} />
                        <div className="h-2 rounded-full" title={`${D.bought}: ${n(r.bought)}`} style={{ width: `${Math.max(1, (r.bought / maxB) * 100)}%`, background: C.teal }} />
                      </div>
                    </td>
                    <td className={`py-2 text-end tabular-nums ${a != null && a < 0.7 ? "text-amber-700" : a != null && a > 1.3 ? "text-brand-700 font-semibold" : ""}`}>
                      {a == null ? "—" : formatNumber(Math.round(a * 100) / 100, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{D.affinityHint}</p>
      </div>
    ) : empty },
    brands: { title: D.w.brands, node: m.brands.length
      ? <BarList rows={m.brands.map((b) => ({ label: b.name, value: b.units, display: n(b.units) }))} /> : empty },
    classes: { title: D.w.classes, node: Object.keys(m.classes).length
      ? <BarList rows={Object.entries(m.classes).map(([k, v]) => ({ label: t.dispensing[k] ?? k, value: v, display: n(v) }))} /> : empty },
    top_products: { title: D.w.top_products, node: m.top_products.length
      ? <BarList rows={m.top_products.map((p) => ({ label: p.name, value: p.revenue, display: `${money(p.revenue)} · ${n(p.units)}` }))} /> : empty },
    top_categories: { title: D.w.top_categories, node: m.top_categories.length
      ? <BarList rows={m.top_categories.map((p) => ({ label: p.name, value: p.revenue, display: `${money(p.revenue)} · ${n(p.units)}` }))} /> : empty },
    top_pharmacies: { title: D.w.top_pharmacies, node: m.top_pharmacies.length
      ? <BarList rows={m.top_pharmacies.map((p) => ({ label: p.name, value: p.revenue, display: `${money(p.revenue)} · ${n(p.orders)}` }))} /> : empty },
    cities: { title: D.w.cities, node: m.cities.length
      ? <BarList rows={m.cities.map((c) => ({ label: c.name, value: c.orders, display: n(c.orders) }))} /> : empty },
    searches: { title: D.w.searches, node: m.searches.length
      ? <BarList color={C.blue} rows={m.searches.map((s) => ({ label: s.q, value: s.n, display: `${n(s.n)} ${D.times}` }))} /> : empty },
    no_results: { title: D.w.no_results, node: m.no_results.length
      ? <BarList color={C.orange} rows={m.no_results.map((s) => ({ label: s.q, value: s.n, display: `${n(s.n)} ${D.times}` }))} /> : empty },
  };
  if (finder) {
    const FT = getFinderTexts(locale);
    const keys = platform ? ["searches", "views", "calls", "reports", "declared", "pending_suggestions", "demoted"] : ["views", "calls", "reports", "declared"];
    w.finder = { title: FT.widget, node: (
      <div className="space-y-4">
        <Stats items={keys.map((k) => ({
          label: FT.st[k], value: n(Number(finder[k as keyof FinderStats] ?? 0)),
          tone: (k === "demoted" || k === "reports") && Number(finder[k as keyof FinderStats]) > 0 ? "warn" as const : undefined,
        }))} />
        {finder.top_drugs.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{FT.topDrugs}</h3>
            <BarList color={C.blue} rows={finder.top_drugs.map((d) => ({ label: d.name, value: d.views, display: `${n(d.views)} · ${FT.calls(n(d.calls))}` }))} />
          </div>
        )}
        {platform && finder.unmet.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{FT.unmet}</h3>
            <BarList color={C.orange} rows={finder.unmet.map((d) => ({ label: d.q, value: d.n, display: `${n(d.n)} ${D.times}` }))} />
          </div>
        )}
      </div>
    ) };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{D.period}:</span>
        {[7, 30, 90, 365].map((d) => (
          <Link key={d} href={periodHref(d)}
            className={`rounded-lg px-3 py-1.5 ${m.days === d ? "bg-brand-700 text-white" : "border border-line bg-white hover:bg-brand-50"}`}>
            {D.days(n(d))}
          </Link>
        ))}
      </div>
      <DashboardGrid scope={scope} layout={layout} widgets={w} texts={{
        edit: D.edit, done: D.done, save: D.save, saved: D.saved, reset: D.reset, hidden: D.hidden,
        show: D.show, hide: D.hide, up: D.up, down: D.down, size: D.size, dragHint: D.dragHint,
      }} />
      <p className="text-xs text-muted">{platform ? D.privacyNote : `${D.pharmacyNote} ${D.privacyNote}`}</p>
    </div>
  );
}
