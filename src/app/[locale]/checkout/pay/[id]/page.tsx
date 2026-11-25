import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney, isLocale, resolveLocale } from "@/i18n";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { CART_COOKIE, isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Test gateway: stands in for the bank until the real gateway is connected.
async function complete(formData: FormData, success: boolean) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(formData.get("order_id"));
  if (!isUuid(id)) redirect(`/${locale}/account/orders`);
  const supabase = await createClient();
  const { data } = await supabase.rpc("test_gateway_complete", { p_order: id, p_success: success });
  const result = typeof data === "string" ? data : "failed";
  if (result === "paid") (await cookies()).set(CART_COOKIE, "", { path: "/", maxAge: 0 });
  redirect(`/${locale}/account/orders/${id}?pay=${result}`);
}
async function paySuccess(formData: FormData) {
  "use server";
  await complete(formData, true);
}
async function payFail(formData: FormData) {
  "use server";
  await complete(formData, false);
}

export default async function TestGatewayPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const o = getOrderTexts(locale);
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/checkout/pay/${id}`)}`);
  const { data } = await supabase.from("orders").select("id, order_no, status, grand_total").eq("id", id).eq("user_id", user.id).maybeSingle();
  const order = data as { id: string; order_no: string; status: string; grand_total: number } | null;
  if (!order) notFound();
  if (order.status !== "awaiting_payment") redirect(`/${locale}/account/orders/${id}`);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="card space-y-4 border-dashed">
        <div>
          <h1 className="text-xl font-extrabold">{o.gatewayTitle}</h1>
          <p className="text-xs text-amber-800">{o.gatewayNote}</p>
        </div>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{o.orderNo}</dt><dd dir="ltr">{order.order_no}</dd></div>
          <div className="flex justify-between text-lg font-bold"><dt>{o.amount}</dt><dd>{formatMoney(order.grand_total, locale)}</dd></div>
        </dl>
        <p className="text-xs text-muted">{o.escrowNote}</p>
        <form action={paySuccess}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="order_id" value={order.id} />
          <SubmitButton className="btn w-full">{o.paySuccess}</SubmitButton>
        </form>
        <form action={payFail}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="order_id" value={order.id} />
          <SubmitButton className="btn-ghost w-full">{o.payFail}</SubmitButton>
        </form>
      </div>
    </div>
  );
}
