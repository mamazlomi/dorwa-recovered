import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney, formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { decideHoldingLink } from "@/lib/staffActions";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Stat = {
  pharmacy_id: string; slug: string; name_fa: string; name_i18n: I18n; orders: number; delivered: number; cancelled: number;
  items_total: number; shipping_total: number; dorva_amount: number; pharmacy_amount: number;
  tech_reviewed: number; tech_rejected: number; stock_lines: number; out_of_stock: number;
};
type LinkRow = { id: string; status: string; created_at: string; pharmacies: { name_fa: string; name_i18n: I18n; slug: string } | null };
type StockRow = { product_id: string; name_fa: string; dispensing_class: string; quantity: number; list_price: number | null; discount_pct: number; final_price: number | null };
type OrderRow = { order_no: string; created_at: string; status: string; kind: string; subtotal: number; shipping_fee: number; items: { name: string; qty: number; line_total: number; tech_status: string }[] };
const DAYS = [7, 30, 90, 365];

async function requestLink(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = formData.get("holding_id");
  if (!isUuid(id)) redirect(`/${locale}/holding`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("holding_request", {
    p_holding: id, p_slug: String(formData.get("slug") ?? ""), p_message: String(formData.get("message") ?? "") || null,
  });
  redirect(`/${locale}/holding/${id}?r=${error ? "unknown" : String(data)}`);
}

export default async function HoldingPage({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ r?: string; days?: string; ph?: string; view?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const s = getStaffTexts(locale);
  const o = getOrderTexts(locale);
  const sp = await searchParams;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/holding/${id}`);
  const supabase = await createClient();
  const { data: hData } = await supabase.from("holdings").select("id, name, status").eq("id", id).maybeSingle();
  const holding = hData as { id: string; name: string; status: string } | null;
  if (!holding) notFound();
  const days = DAYS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const ph = isUuid(sp.ph) ? sp.ph : null;
  const view = sp.view === "orders" ? "orders" : "stock";

  const [{ data: statData }, { data: linkData }, detail] = await Promise.all([
    supabase.rpc("holding_stats", { p_holding: id, p_days: days }),
    supabase.from("holding_links").select("id, status, created_at, pharmacies(name_fa, name_i18n, slug)").eq("holding_id", id)
      .in("status", ["requested", "active"]).order("created_at", { ascending: false }),
    ph ? (view === "orders"
      ? supabase.rpc("holding_orders", { p_holding: id, p_pharmacy: ph, p_limit: 100 })
      : supabase.rpc("holding_stock", { p_holding: id, p_pharmacy: ph })) : Promise.resolve({ data: null }),
  ]);
  const stats = (statData as Stat[]) ?? [];
  const links = (linkData as unknown as LinkRow[]) ?? [];
  const fmt = (n: number) => formatNumber(Number(n), locale);
  const money = (n: number) => formatMoney(n, locale);
  const sum = (k: keyof Stat) => stats.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const base = `/${locale}/holding/${id}`;
  const q = (extra: Record<string, string | null>) => {
    const u = new URLSearchParams({ days: String(days), ...(ph ? { ph } : {}), ...(ph ? { view } : {}) });
    Object.entries(extra).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)));
    return `${base}?${u.toString()}`;
  };
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" });
  const OKS = new Set(["ok", "done"]);
  const msg = sp.r ? (s.requestResult[sp.r] ?? s.results[sp.r] ?? s.results.unknown) : null;
  const phName = ph ? stats.find((x) => x.pharmacy_id === ph) : undefined;

  return (
    <div className="space-y-4">
      <Link href={`/${locale}/holding`} className="text-sm text-brand-700 hover:underline">{s.holdingsTitle}</Link>
      <h1 className="text-2xl font-extrabold">{holding.name}</h1>
      <p className="text-xs text-muted">{s.privacy}</p>
      {msg && (OKS.has(sp.r!) ? <OkBox message={msg} /> : <ErrorBox message={msg} />)}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{s.period}:</span>
        {DAYS.map((d) => <Link key={d} href={q({ days: String(d) })} className={`chip ${d === days ? "bg-brand-600 text-white" : ""}`}>{s.days(fmt(d))}</Link>)}
      </div>

      {stats.length === 0 ? <p className="card text-sm text-muted">{s.noData}</p> : (
        <section className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-start">{s.colPharmacy}</th><th className="text-start">{s.colOrders}</th>
                <th className="text-start">{s.colDelivered}</th><th className="text-start">{s.colCancelled}</th>
                <th className="text-start">{s.colItems}</th><th className="text-start">{s.colShipping}</th>
                <th className="text-start">{s.colDorva}</th><th className="text-start">{s.colPharmacyShare}</th>
                <th className="text-start">{s.colRejectRate}</th><th className="text-start">{s.colStock}</th><th />
              </tr>
            </thead>
            <tbody>
              {stats.map((x) => (
                <tr key={x.pharmacy_id} className={`border-b border-line align-top ${ph === x.pharmacy_id ? "bg-brand-50" : ""}`}>
                  <td className="py-2 font-medium">{localized(x.name_fa, x.name_i18n, locale)}</td>
                  <td>{fmt(x.orders)}</td><td>{fmt(x.delivered)}</td><td>{fmt(x.cancelled)}</td>
                  <td>{money(x.items_total)}</td><td>{money(x.shipping_total)}</td>
                  <td>{money(x.dorva_amount)}</td><td>{money(x.pharmacy_amount)}</td>
                  <td>{x.tech_reviewed ? `${fmt(Math.round((x.tech_rejected / x.tech_reviewed) * 100))}٪` : "—"}</td>
                  <td>{fmt(x.stock_lines)} ({fmt(x.out_of_stock)})</td>
                  <td className="whitespace-nowrap text-xs">
                    <Link href={q({ ph: x.pharmacy_id, view: "stock" })} className="text-brand-700 hover:underline">{s.viewStock}</Link>
                    {" · "}
                    <Link href={q({ ph: x.pharmacy_id, view: "orders" })} className="text-brand-700 hover:underline">{s.viewOrders}</Link>
                  </td>
                </tr>
              ))}
              {stats.length > 1 && (
                <tr className="font-bold">
                  <td className="py-2">{s.total}</td><td>{fmt(sum("orders"))}</td><td>{fmt(sum("delivered"))}</td><td>{fmt(sum("cancelled"))}</td>
                  <td>{money(sum("items_total"))}</td><td>{money(sum("shipping_total"))}</td><td>{money(sum("dorva_amount"))}</td>
                  <td>{money(sum("pharmacy_amount"))}</td><td /><td>{fmt(sum("stock_lines"))} ({fmt(sum("out_of_stock"))})</td><td />
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {ph && phName && view === "stock" && (
        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-bold">{localized(phName.name_fa, phName.name_i18n, locale)} — {s.viewStock}</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-line">
              <th className="py-2 text-start">{s.product}</th><th className="text-start">{s.qty}</th><th className="text-start">{s.price}</th>
              <th className="text-start">{s.discount}</th><th className="text-start">{s.finalPrice}</th></tr></thead>
            <tbody>
              {((detail.data as StockRow[]) ?? []).map((r) => (
                <tr key={r.product_id} className="border-b border-line last:border-0">
                  <td className="py-1.5">{r.name_fa} <span className="text-xs text-muted">({t.dispensing[r.dispensing_class]})</span></td>
                  <td className={r.quantity === 0 ? "text-red-700" : ""}>{fmt(r.quantity)}</td>
                  <td>{money(r.list_price ?? 0)}</td><td>{Number(r.discount_pct) ? `${fmt(r.discount_pct)}٪` : "—"}</td>
                  <td>{r.final_price != null ? money(r.final_price) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {ph && phName && view === "orders" && (
        <section className="card space-y-2">
          <h2 className="font-bold">{localized(phName.name_fa, phName.name_i18n, locale)} — {s.viewOrders}</h2>
          <ul className="divide-y divide-line text-sm">
            {((detail.data as OrderRow[]) ?? []).map((r) => (
              <li key={`${r.order_no}-${r.created_at}`} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b dir="ltr">{r.order_no}</b> · <span className="text-xs text-muted">{date.format(new Date(r.created_at))}</span>{r.kind === "intercity" ? ` · ${o.intercity}` : ""}</span>
                  <span className="flex items-center gap-2"><span className="chip">{o.partStatus[r.status] ?? r.status}</span><b>{money(r.subtotal)}</b></span>
                </div>
                <p className="text-xs text-muted">{r.items.map((i) => `${i.name} × ${fmt(i.qty)}${i.tech_status === "rejected" ? ` (${o.techStatus.rejected})` : ""}`).join("، ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-bold">{s.requestTitle}</h2>
        <form action={requestLink} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="locale" value={locale} /><input type="hidden" name="holding_id" value={id} />
          <label><span className="label">{s.slug}</span><input name="slug" required dir="ltr" className="input" /></label>
          <label><span className="label">{s.message}</span><input name="message" maxLength={300} className="input" /></label>
          <SubmitButton className="btn">{s.request}</SubmitButton>
        </form>
        {links.length > 0 && (
          <ul className="divide-y divide-line text-sm">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{l.pharmacies ? localized(l.pharmacies.name_fa, l.pharmacies.name_i18n, locale) : "—"} <span className="chip ms-1">{s.linkStatus[l.status] ?? l.status}</span></span>
                <form action={decideHoldingLink}>
                  <input type="hidden" name="locale" value={locale} /><input type="hidden" name="back" value={base} />
                  <input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="act" value="revoke" />
                  <SubmitButton className="btn-ghost py-1 text-xs text-red-700">{s.withdraw}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
