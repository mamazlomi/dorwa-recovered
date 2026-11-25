import Link from "next/link";
import { redirect } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { PlanParts } from "@/components/PlanParts";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, localized, resolveLocale } from "@/i18n";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { readAddress } from "@/lib/address";
import { isUuid, readCart, toRpcItems } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import type { Plan } from "@/lib/plan";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Params = { params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string; error?: string }> };

async function placeOrder(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const ph = formData.get("ph");
  const force = isUuid(ph) ? ph : null;
  const back = `/${locale}/checkout${force ? `?ph=${force}&` : "?"}`;
  const [cart, addr] = await Promise.all([readCart(), readAddress()]);
  if (!addr?.id) redirect(`${back}error=address`);
  const supabase = await createClient();
  // prices and pharmacies are recomputed in the database; nothing from the page is trusted
  const { data, error } = await supabase.rpc("place_order", {
    p_items: toRpcItems(cart), p_address: addr.id, p_preferred: cart.pref ?? null, p_force: force,
  });
  if (error || !data) redirect(`${back}error=${error?.message.includes("nothing") ? "nothing" : "place"}`);
  redirect(`/${locale}/checkout/pay/${data}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getOrderTexts(locale).checkoutTitle, robots: { index: false } };
}

export default async function CheckoutPage({ params, searchParams }: Params) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const o = getOrderTexts(locale);
  const sp = await searchParams;
  const force = isUuid(sp.ph) ? sp.ph : null;
  const here = `/${locale}/checkout${force ? `?ph=${force}` : ""}`;
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(here)}`);
  const [cart, addr] = await Promise.all([readCart(), readAddress()]);
  if (cart.items.length === 0) redirect(`/${locale}/cart`);

  const { data: addrRow } = addr?.id
    ? await supabase.from("customer_addresses").select("id, label, address_line, plaque, unit, recipient, phone, lat, lng, city_id").eq("id", addr.id).maybeSingle()
    : { data: null };
  const a = addrRow as { id: string; label: string; address_line: string | null; plaque: string | null; unit: string | null;
    recipient: string | null; phone: string | null; lat: number; lng: number; city_id: number | null } | null;

  const ids = cart.items.map((l) => l.p);
  const [{ data: productsData }, planRes] = await Promise.all([
    supabase.from("catalog_products").select("id, name_fa, name_i18n").in("id", ids),
    a ? supabase.rpc("plan_cart_v2", { p_items: toRpcItems(cart), p_city: a.city_id, p_lat: a.lat, p_lng: a.lng,
      p_preferred: cart.pref ?? null, p_force: force }) : Promise.resolve({ data: null }),
  ]);
  const plan = planRes.data as Plan | null;
  const names = new Map(((productsData as { id: string; name_fa: string; name_i18n: I18n }[]) ?? []).map((p) => [p.id, localized(p.name_fa, p.name_i18n, locale)]));
  const name = (id: string) => names.get(id) ?? "—";
  const sep = locale === "en" ? ", " : "، ";
  const dropped = plan ? [...plan.unavailable, ...plan.needs_prescription] : [];
  const errors: Record<string, string> = { address: o.noAddress, nothing: o.nothing, place: o.placeError };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={`/${locale}/cart`} className="text-sm text-brand-700 hover:underline">{t.cart.title}</Link>
      <h1 className="text-2xl font-extrabold">{o.checkoutTitle}</h1>
      {sp.error && <ErrorBox message={errors[sp.error] ?? o.placeError} />}

      <section className="card space-y-2">
        <h2 className="font-bold">{o.deliverTo}</h2>
        {a ? (
          <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
            <div className="space-y-1">
              <p className="font-semibold">{a.label}</p>
              <p className="text-muted">{[a.address_line, a.plaque && `#${a.plaque}`, a.unit && `${a.unit}`].filter(Boolean).join(" — ")}</p>
              {(a.recipient || a.phone) && <p className="text-muted">{o.recipient}: {[a.recipient, a.phone].filter(Boolean).join(" · ")}</p>}
              {!a.city_id && <p className="text-amber-800">{o.outsideArea}</p>}
            </div>
            <Link href={`/${locale}/account/address?back=${encodeURIComponent(here)}`} className="btn-ghost py-1.5 text-xs">{o.changeAddress}</Link>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p>{o.noAddress}</p>
            <AddressChip locale={locale} address={null} back={here} />
          </div>
        )}
      </section>

      {plan && (
        <section className="card space-y-3">
          {plan.strategy === "intercity" && <p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">{o.intercityChosen}</p>}
          {plan.pharmacies.length > 0
            ? <PlanParts plan={plan} locale={locale} name={name} subtotalLabel={t.cart.subtotal} totalLabel={o.grandTotal} />
            : <p className="text-sm text-muted">{o.nothing} <Link href={`/${locale}/cart`} className="text-brand-700 hover:underline">{t.cart.title}</Link></p>}
          {dropped.length > 0 && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
              <p className="mb-1">{o.dropped}</p>
              <p className="font-medium">{dropped.map(name).join(sep)}</p>
            </div>
          )}
          {plan.pharmacies.length > 0 && (
            <>
              <p className="text-xs text-muted">{o.techNote}</p>
              <p className="text-xs text-muted">{o.escrowNote}</p>
              <form action={placeOrder}>
                <input type="hidden" name="locale" value={locale} />
                {force && <input type="hidden" name="ph" value={force} />}
                <SubmitButton className="btn w-full">{o.payTest}</SubmitButton>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}
