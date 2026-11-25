import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { formatMoney, resolveLocale } from "@/i18n";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { isConfigured } from "@/lib/config";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  awaiting_payment: "bg-amber-50 text-amber-800", paid: "", completed: "bg-brand-50 text-brand-700",
  cancelled: "bg-red-50 text-red-700", expired: "bg-slate-100 text-slate-600",
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getOrderTexts(locale).myOrders };
}

export default async function MyOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const o = getOrderTexts(locale);
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/account/orders`);
  const { data } = await supabase.from("orders")
    .select("id, order_no, status, grand_total, created_at, expires_at").eq("user_id", user.id)
    .order("created_at", { ascending: false }).limit(50);
  const orders = (data as { id: string; order_no: string; status: string; grand_total: number; created_at: string; expires_at: string }[]) ?? [];
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/${locale}/account`} className="text-sm text-brand-700 hover:underline">{t.nav.account}</Link>
      <h1 className="text-2xl font-extrabold">{o.myOrders}</h1>
      {orders.length === 0 ? <p className="card text-sm text-muted">{o.noOrders}</p> : (
        <ul className="card divide-y divide-line p-0">
          {orders.map((x) => {
            const unpaid = x.status === "awaiting_payment" && new Date(x.expires_at) > new Date();
            return (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-semibold" dir="ltr">{x.order_no}</p>
                  <p className="text-xs text-muted">{date.format(new Date(x.created_at))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${STATUS_CLASS[x.status] ?? ""}`}>{o.status[x.status] ?? x.status}</span>
                  <b>{formatMoney(x.grand_total, locale)}</b>
                  {unpaid && <Link href={`/${locale}/checkout/pay/${x.id}`} className="btn py-1.5 text-xs">{o.payNow}</Link>}
                  <Link href={`/${locale}/account/orders/${x.id}`} className="btn-ghost py-1.5 text-xs">{o.viewOrder}</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
