import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { formatMoney, formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { getOrderRuleTexts } from "@/i18n/dictionaries/orderRules";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Item = { id: string; name_fa: string; qty: number; unit_price: number; line_total: number; tech_status: string; tech_note: string | null };
type Part = {
  id: string; seq: number; kind: string; status: string; subtotal: number; shipping_fee: number; eta: string | null;
  min_days: number | null; max_days: number | null; shipping_full: number | null; cancel_reason: string | null;
  tech_deadline: string | null; reassign_count: number;
  pharmacies: { slug: string; name_fa: string; name_i18n: I18n } | null;
  order_items: Item[];
  order_delivery_codes: { code: string; expires_at: string } | { code: string; expires_at: string }[] | null;
};
type Order = {
  id: string; order_no: string; status: string; address: Record<string, string | null>; items_total: number;
  shipping_total: number; grand_total: number; refunded_total: number; created_at: string; expires_at: string; paid_at: string | null;
  payments: { status: string; gateway: string; gateway_ref: string | null } | null;
};

const PART_CLASS: Record<string, string> = {
  pending_tech: "bg-amber-50 text-amber-800", preparing: "", shipped: "bg-sky-50 text-sky-800",
  delivered: "bg-brand-50 text-brand-700", cancelled: "bg-red-50 text-red-700", awaiting_payment: "bg-slate-100 text-slate-600",
};

async function cancelOrder(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = formData.get("order_id");
  const part = formData.get("part_id");
  if (!isUuid(id)) redirect(`/${locale}/account/orders`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_cancel", { p_order: id, p_part: isUuid(part) ? part : null });
  redirect(`/${locale}/account/orders/${id}?cancel=${error ? "not_allowed" : String(data)}`);
}

export default async function OrderPage({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ pay?: string; cancel?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const o = getOrderTexts(locale);
  const R = getOrderRuleTexts(locale);
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/account/orders/${id}`);
  const [{ data: od }, { data: pd }, { data: setData }] = await Promise.all([
    supabase.from("orders").select("id, order_no, status, address, items_total, shipping_total, grand_total, refunded_total, created_at, expires_at, paid_at, payments(status, gateway, gateway_ref)")
      .eq("id", id).eq("user_id", user.id).maybeSingle(),
    supabase.from("order_parts").select("id, seq, kind, status, subtotal, shipping_fee, eta, min_days, max_days, shipping_full, cancel_reason, tech_deadline, reassign_count, pharmacies(slug, name_fa, name_i18n), order_items(id, name_fa, qty, unit_price, line_total, tech_status, tech_note), order_delivery_codes(code, expires_at)")
      .eq("order_id", id).order("seq"),
    supabase.from("settings").select("key, value").eq("scope", "platform").in("key", ["order.customer_cancel", "tech_approval.window_min"]),
  ]);
  const cfg = new Map(((setData as { key: string; value: unknown }[]) ?? []).map((r) => [r.key, r.value]));
  const cancelMode = String(cfg.get("order.customer_cancel") ?? "before_ship");
  const windowMin = Number(cfg.get("tech_approval.window_min") ?? 15);
  const canCancel = (st: string) => cancelMode === "before_ship" ? ["pending_tech", "preparing"].includes(st) : cancelMode === "before_tech" ? st === "pending_tech" : false;
  const order = od as unknown as Order | null;
  if (!order) notFound();
  const parts = (pd as unknown as Part[]) ?? [];
  const fmt = (n: number) => formatNumber(n, locale);
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });
  const pay = Array.isArray(order.payments) ? order.payments[0] : order.payments;
  const unpaid = order.status === "awaiting_payment" && new Date(order.expires_at) > new Date();
  const time = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { timeStyle: "short", timeZone: "Asia/Tehran" });
  const deadlineOf = (p: Part) => p.tech_deadline ? new Date(p.tech_deadline) : order.paid_at ? new Date(new Date(order.paid_at).getTime() + windowMin * 60000) : null;
  const cancellable = parts.filter((p) => canCancel(p.status));
  const cancelForm = (label: string, partId?: string) => (
    <form action={cancelOrder}>
      <input type="hidden" name="locale" value={locale} /><input type="hidden" name="order_id" value={order.id} />
      {partId && <input type="hidden" name="part_id" value={partId} />}
      <SubmitButton className="btn-ghost py-1 text-xs text-red-700">{label}</SubmitButton>
    </form>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/${locale}/account/orders`} className="text-sm text-brand-700 hover:underline">{o.myOrders}</Link>
      {sp.pay && (sp.pay === "paid" ? <OkBox message={o.payResult.paid} /> : <ErrorBox message={o.payResult[sp.pay] ?? o.payResult.failed} />)}
      {sp.cancel && (sp.cancel === "cancelled" ? <OkBox message={R.cancelResult.cancelled} /> : <ErrorBox message={R.cancelResult[sp.cancel] ?? R.cancelResult.not_allowed} />)}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{o.orderTitle("")}<span dir="ltr">{order.order_no}</span></h1>
        <span className="chip">{o.status[order.status] ?? order.status}</span>
      </div>
      <p className="text-xs text-muted">{o.placedAt}: {date.format(new Date(order.created_at))}</p>
      <div className="flex flex-wrap items-center gap-2">
        {unpaid && <Link href={`/${locale}/checkout/pay/${order.id}`} className="btn">{o.payNow}</Link>}
        {(unpaid || cancellable.length > 1) && cancelForm(R.cancelOrder)}
      </div>
      {cancellable.length > 0 && <p className="text-xs text-muted">{R.cancelConfirm}</p>}

      {parts.map((p) => {
        const code = Array.isArray(p.order_delivery_codes) ? p.order_delivery_codes[0] : p.order_delivery_codes;
        const showCode = code && ["pending_tech", "preparing", "shipped"].includes(p.status);
        return (
          <section key={p.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">
                {p.pharmacies ? localized(p.pharmacies.name_fa, p.pharmacies.name_i18n, locale) : "—"}
                {p.kind === "intercity" && <span className="chip ms-2 bg-amber-50 text-amber-800">{o.intercity}</span>}
              </h2>
              <span className={`chip ${PART_CLASS[p.status] ?? ""}`}>{o.partStatus[p.status] ?? p.status}</span>
            </div>
            {p.status === "cancelled" && p.cancel_reason && <p className="text-xs text-red-700">{R.reason[p.cancel_reason] ?? p.cancel_reason}</p>}
            {p.status === "pending_tech" && deadlineOf(p) && <p className="text-xs text-amber-800">{R.customerDeadline(time.format(deadlineOf(p)!))}</p>}
            {p.reassign_count > 0 && p.status !== "cancelled" && <p className="text-xs text-muted">{R.reassigned(fmt(p.reassign_count))}</p>}
            {p.status !== "delivered" && p.status !== "cancelled" && p.eta && (
              <p className="text-xs text-muted">
                {p.eta === "days" ? o.eta.days(fmt(p.min_days ?? 0), fmt(p.max_days ?? 0)) : o.eta[p.eta as "today" | "tomorrow"]}
              </p>
            )}
            <ul className="divide-y divide-line text-sm">
              {p.order_items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div>
                    <p className={i.tech_status === "rejected" ? "text-muted line-through" : ""}>{i.name_fa} × {fmt(i.qty)}</p>
                    {i.tech_status !== "na" && (
                      <p className={`text-xs ${i.tech_status === "rejected" ? "text-red-700" : "text-muted"}`}>
                        {o.techStatus[i.tech_status]}{i.tech_note ? ` — ${o.reason}: ${i.tech_note}` : ""}
                      </p>
                    )}
                  </div>
                  <span>{formatMoney(i.line_total, locale)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between text-sm"><span>{o.shipping}</span><span>
              {Number(p.shipping_full ?? 0) > Number(p.shipping_fee) && <span className="me-2 text-xs text-muted line-through">{formatMoney(p.shipping_full, locale)}</span>}
              {Number(p.shipping_fee) === 0 ? o.free : formatMoney(p.shipping_fee, locale)}</span></p>
            {canCancel(p.status) && cancelForm(R.cancelPart, p.id)}
            {showCode && (
              <div className="rounded-xl bg-brand-50 p-3 text-center">
                <p className="text-xs text-muted">{o.deliveryCode}</p>
                <p className="text-3xl font-extrabold tracking-[0.3em]" dir="ltr">{code.code}</p>
                <p className="mt-1 text-xs text-muted">{o.codeHint}</p>
              </div>
            )}
          </section>
        );
      })}

      <section className="card space-y-1 text-sm">
        <p className="flex justify-between"><span>{o.itemsTotal}</span><span>{formatMoney(order.items_total, locale)}</span></p>
        <p className="flex justify-between"><span>{o.shipping}</span><span>{formatMoney(order.shipping_total, locale)}</span></p>
        <p className="flex justify-between font-bold"><span>{o.grandTotal}</span><span>{formatMoney(order.grand_total, locale)}</span></p>
        {Number(order.refunded_total) > 0 && (
          <p className="flex justify-between text-brand-700"><span>{o.refunded}</span><span>{formatMoney(order.refunded_total, locale)}</span></p>
        )}
        {pay && <p className="flex justify-between pt-2 text-xs text-muted"><span>{o.payment}</span><span>{o.payStatus[pay.status] ?? pay.status}{pay.gateway_ref ? ` · ${pay.gateway_ref}` : ""}</span></p>}
      </section>

      <section className="card space-y-1 text-sm">
        <h2 className="font-bold">{o.deliverTo}</h2>
        <p>{order.address.label}</p>
        <p className="text-muted">{[order.address.address_line, order.address.plaque && `#${order.address.plaque}`, order.address.unit].filter(Boolean).join(" — ")}</p>
      </section>
    </div>
  );
}
