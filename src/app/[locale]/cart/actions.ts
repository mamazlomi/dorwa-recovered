"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { isUuid, readCart, writeCart } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";

function safeBack(v: FormDataEntryValue | null, fallback: string) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

export async function addToCart(formData: FormData) {
  const product = formData.get("product_id");
  const pharmacy = formData.get("pharmacy_id");
  const locale = String(formData.get("locale"));
  const back = safeBack(formData.get("back"), `/${isLocale(locale) ? locale : "fa"}`);
  const qty = Math.min(Math.max(Math.trunc(Number(formData.get("qty")) || 1), 1), 99);
  let capped = false;
  if (isUuid(product)) {
    const supabase = await createClient();
    // never more than the stock (of this pharmacy, or the best-stocked one)
    const { data: maxData } = await supabase.rpc("product_max_qty", { p_product: product, p_pharmacy: isUuid(pharmacy) ? pharmacy : null });
    const cap = typeof maxData === "number" ? maxData : 99;
    const cart = await readCart();
    const line = cart.items.find((l) => l.p === product);
    const want = (line?.q ?? 0) + qty;
    const next = Math.min(want, cap, 99);
    capped = want > next;
    if (next > 0) {
      if (line) line.q = next;
      else cart.items.push({ p: product, q: next });
      // remember where the customer shopped: kept if it can serve the whole basket
      if (isUuid(pharmacy)) cart.pref = pharmacy;
      await writeCart(cart);
      // anonymous "added to cart" event for the dashboards' funnel
      await supabase.rpc("track_event", { p_kind: "cart_add", p_product: product }).then(() => null, () => null);
    }
  }
  const url = new URL(back, "http://x");
  url.searchParams.set("added", String(product));
  if (capped) url.searchParams.set("capped", "1");
  redirect(`${url.pathname}${url.search}#p-${product}`);
}

export async function setQty(formData: FormData) {
  const product = formData.get("product_id");
  const qty = Number(formData.get("qty"));
  if (isUuid(product) && Number.isFinite(qty)) {
    const supabase = await createClient();
    const { data: maxData } = await supabase.rpc("product_max_qty", { p_product: product, p_pharmacy: null });
    const cap = typeof maxData === "number" && maxData > 0 ? maxData : 99;
    const cart = await readCart();
    cart.items = cart.items
      .map((l) => (l.p === product ? { ...l, q: Math.min(Math.max(Math.trunc(qty), 0), 99, cap) } : l))
      .filter((l) => l.q > 0);
    await writeCart(cart);
  }
  revalidatePath("/[locale]/cart", "page");
}

export async function removeLines(formData: FormData) {
  const ids = String(formData.get("ids") ?? "").split(",").filter(isUuid);
  if (ids.length) {
    const cart = await readCart();
    cart.items = cart.items.filter((l) => !ids.includes(l.p));
    await writeCart(cart);
  }
  revalidatePath("/[locale]/cart", "page");
}
