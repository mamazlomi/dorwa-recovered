import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney, formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import { getOrderRuleTexts } from "@/i18n/dictionaries/orderRules";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Item = { id: string; name_fa: string; dispensing_class: string; qty: number; line_total: number; tech_status: string; tech_note: string | null };
type Part = {
  id: string; pharmacy_id: string; kind: string; status: string; shipping_provider: string; cancel_reason: string | null; tech_deadline: string | null; subtotal: number; shipping_fee: number; distance_km: number | null;
  pharmacies: { name_fa: string; name_i18n: I18n } | null;
  orders: { order_no: string; created_at: string; paid_at: string | null; address: Record<string, string | number | null> } | null;
  order_items: Item[];
  settlements: { pharmacy_amount: number; dorva_amount: number; logistics_amount: number; logistics_payee: string; status: string } | null;
};
const TABS = ["pending_tech", "preparing", "shipped", "delivered", "cancelled", "all"] as const;

function ctx(formData: FormData) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const b = String(formData.get("back") ?? "");
  const back = b.startsWith(`/${locale}/pharmacy/orders`) ? b : `/${locale}/pharmacy/orders`;
  const go = (msg: string) => redirect(`${back}${back.includes("?") ? "&" : "?"}${msg}`);
  return { go };
}
async function approveItem(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const id = formData.get("item_id");
  if (!isUuid(id)) go("err=1");
  const supabase = await createClient();
  const { error } = await supabase.rpc("tech_review", { p_item: id, p_approve: true });
  go(error ? "err=1" : "ok=1");
}
async function rejectItem(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const id = formData.get("item_id");
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (!isUuid(id) || !note) go("err=reason");
  const supabase = await createClient();
  const { error } = await supabase.rpc("tech_review", { p_item: id, p_approve: false, p_note: note });
  go(error ? "err=1" : "ok=1");
}
async function shipPart(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const id = formData.get("part_id");
  if (!isUuid(id)) go("err=1");
  const supabase = await createClient();
  const { error } = await supabase.rpc("part_ship", { p_part: id });
  go(error ? "err=1" : "ok=1");
}
async function deliverPart(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const id = formData.get("part_id");
  if (!isUuid(id)) go("err=1");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("part_deliver", { p_part: id, p_code: String(formData.get("code") ?? "") });
  go(error ? "err=1" : `deliver=${typeof data === "string" ? data : "wrong"}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getOrderTexts(locale).deskTitle };
}

export default async function PharmacyOrdersPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; ph?: string; ok?: string; err?: string; deliver?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const o = getOrderTexts(locale);
  const lg = getLogisticsTexts(locale);
  const sp = await searchParams;
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/orders`);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "pending_tech";
  const ph = isUuid(sp.ph) ? sp.ph : null;

  // RLS returns only parts of pharmacies this user may operate
  let q = supabase.from("order_parts")
    .select("id, pharmacy_id, kind, status, shipping_provider, cancel_reason, tech_deadline, subtotal, shipping_fee, distance_km, pharmacies(name_fa, name_i18n), orders(order_no, created_at, paid_at, address), order_items(id, name_fa, dispensing_class, qty, line_total, tech_status, tech_note), settlements(pharmacy_amount, dorva_amount, logistics_amount, logistics_payee, status)")
    .neq("status", "awaiting_payment").order("id", { ascending: false }).limit(100);
  if (tab !== "all") q = q.eq("status", tab);
  if (ph) q = q.eq("pharmacy_id", ph);
  const [{ data }, { data: allData }, { data: winData }] = await Promise.all([
    q,
    supabase.from("order_parts").select("pharmacy_id, status, pharmacies(name_fa, name_i18n)").neq("status", "awaiting_payment").limit(1000),
    supabase.from("settings").select("value").eq("scope", "platform").eq("key", "tech_approval.window_min").maybeSingle(),
  ]);
  const R = getOrderRuleTexts(locale);
  const windowMin = Number((winData as { value: unknown } | null)?.value ?? 15);
  const time = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { timeStyle: "short", timeZone: "Asia/Tehran" });
  const deadlineOf = (p: Part) => p.tech_deadline ? new Date(p.tech_deadline) : p.orders?.paid_at ? new Date(new Date(p.orders.paid_at).getTime() + windowMin * 60000) : null;
  const parts = ((data as unknown as Part[]) ?? []).sort((a, b) => (b.orders?.created_at ?? "").localeCompare(a.orders?.created_at ?? ""));
  const all = (allData as unknown as { pharmacy_id: string; status: string; pharmacies: { name_fa: string; name_i18n: I18n } | null }[]) ?? [];
  const pharmacies = [...new Map(all.map((x) => [x.pharmacy_id, x.pharmacies])).entries()];
  const counts = (s: string) => all.filter((x) => (s === "all" || x.status === s) && (!ph || x.pharmacy_id === ph)).length;
  const fmt = (n: number) => formatNumber(n, locale);
  const self = `/${locale}/pharmacy/orders?tab=${tab}${ph ? `&ph=${ph}` : ""}`;
  const link = (extra: Record<string, string | null>) => {
    const u = new URLSearchParams({ tab, ...(ph ? { ph } : {}) });
    Object.entries(extra).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)));
    return `/${locale}/pharmacy/orders?${u.toString()}`;
  };
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" });
  const hidden = (name: string, value: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={self} />
      <input type="hidden" name={name} value={value} />
    </>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{o.deskTitle}</h1>
      {sp.ok && <OkBox message="✓" />}
      {sp.err && <ErrorBox message={sp.err === "reason" ? o.rejectReason : t.dashboard.errors.unknown} />}
      {sp.deliver && (sp.deliver === "delivered" ? <OkBox message={o.deliverResult.delivered} /> : <ErrorBox message={o.deliverResult[sp.deliver] ?? o.deliverResult.wrong} />)}

      {pharmacies.length > 1 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={link({ ph: null })} className={`chip ${!ph ? "bg-brand-600 text-white" : ""}`}>{o.allPharmacies}</Link>
          {pharmacies.map(([pid, p]) => (
            <Link key={pid} href={link({ ph: pid })} className={`chip ${ph === pid ? "bg-brand-600 text-white" : ""}`}>
              {p ? localized(p.name_fa, p.name_i18n, locale) : pid}
            </Link>
          ))}
        </div>
      )}
      <nav className="flex flex-wrap gap-1 border-b border-line text-sm">
        {TABS.map((s) => (
          <Link key={s} href={link({ tab: s })}
            className={`rounded-t-lg px-3 py-2 ${tab === s ? "bg-white font-bold text-brand-700 ring-1 ring-line" : "text-muted hover:text-ink"}`}>
            {s === "all" ? o.filterAll : o.partStatus[s]} ({fmt(counts(s))})
          </Link>
        ))}
      </nav>

      {parts.length === 0 ? <p className="card text-sm text-muted">{o.deskEmpty}</p> : parts.map((p) => {
        const addr = p.orders?.address ?? {};
        const st = Array.isArray(p.settlements) ? p.settlements[0] : p.settlements;
        return (
          <section key={p.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-bold" dir="ltr">{p.orders?.order_no}</p>
                <p className="text-xs text-muted">
                  {p.pharmacies ? localized(p.pharmacies.name_fa, p.pharmacies.name_i18n, locale) : ""}
                  {p.orders ? ` · ${date.format(new Date(p.orders.created_at))}` : ""}
                  {p.kind === "intercity" ? ` · ${o.intercity}` : ""}
                  {` · ${lg.deliveredBy}: ${p.shipping_provider === "pharmacy" ? lg.byPharmacy : lg.byDorva}`}
                </p>
              </div>
              <span className="chip">{o.partStatus[p.status]}</span>
            </div>
            {p.status === "cancelled" && p.cancel_reason && <p className="text-xs text-red-700">{R.deskReason[p.cancel_reason] ?? p.cancel_reason}</p>}
            {p.status === "pending_tech" && deadlineOf(p) && (
              <p className="text-xs text-amber-800">{deadlineOf(p)!.getTime() < Date.now() ? R.deadlinePassed : R.deadline(time.format(deadlineOf(p)!))}</p>
            )}

            <ul className="divide-y divide-line text-sm">
              {p.order_items.map((i) => (
                <li key={i.id} className="space-y-2 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={i.tech_status === "rejected" ? "text-muted line-through" : ""}>
                      {i.name_fa} × {fmt(i.qty)} <span className="text-xs text-muted">({t.dispensing[i.dispensing_class]})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {i.tech_status !== "na" && <span className="text-xs text-muted">{o.techStatus[i.tech_status]}</span>}
                      <b>{formatMoney(i.line_total, locale)}</b>
                    </span>
                  </div>
                  {i.tech_note && <p className="text-xs text-red-700">{o.reason}: {i.tech_note}</p>}
                  {p.status === "pending_tech" && i.tech_status === "pending" && (
                    <div className="flex flex-wrap items-start gap-2">
                      <form action={approveItem}>{hidden("item_id", i.id)}
                        <SubmitButton className="btn py-1.5 text-xs">{o.approve}</SubmitButton></form>
                      <form action={rejectItem} className="flex min-w-0 flex-1 gap-2">{hidden("item_id", i.id)}
                        <input name="note" required maxLength={300} placeholder={o.rejectReason} className="input min-w-0 flex-1 py-1.5 text-xs" />
                        <SubmitButton className="btn-ghost py-1.5 text-xs text-red-700">{o.reject}</SubmitButton></form>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
              <p>
                {o.recipient}: {[addr.recipient, addr.phone].filter(Boolean).join(" · ") || "—"}<br />
                {[addr.label, addr.address_line, addr.plaque && `#${addr.plaque}`, addr.unit].filter(Boolean).join(" — ")}
                {p.distance_km != null ? ` · ${fmt(Number(p.distance_km))} km` : ""}
              </p>
              {st && (
                <p>
                  {o.settlement}: {o.pharmacyShare} {formatMoney(st.pharmacy_amount, locale)} · {o.dorvaShare} {formatMoney(st.dorva_amount, locale)} · {o.logisticsShare} ({st.logistics_payee === "pharmacy" ? lg.byPharmacy : lg.byDorva}) {formatMoney(st.logistics_amount, locale)}
                </p>
              )}
            </div>

            {p.status === "preparing" && (
              <form action={shipPart}>{hidden("part_id", p.id)}
                <SubmitButton className="btn text-sm">{o.ship}</SubmitButton></form>
            )}
            {p.status === "shipped" && (
              <form action={deliverPart} className="flex flex-wrap items-center gap-2">{hidden("part_id", p.id)}
                <input name="code" required inputMode="numeric" dir="ltr" maxLength={8} placeholder={o.codeInput} className="input w-40" />
                <SubmitButton className="btn text-sm">{o.deliver}</SubmitButton>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
