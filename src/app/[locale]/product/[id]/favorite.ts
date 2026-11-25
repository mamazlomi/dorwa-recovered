"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { isUuid } from "@/lib/cart";
import { createClient, getUser } from "@/lib/supabase/server";

/** Adds or removes a product from the signed-in customer's favourites. */
export async function toggleFavorite(formData: FormData) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const product = formData.get("product_id");
  if (!isUuid(product)) redirect(`/${locale}`);
  const back = `/${locale}/product/${product}`;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(back)}`);
  const supabase = await createClient();
  if (formData.get("on") === "1") {
    await supabase.from("favorites").upsert({ user_id: user.id, product_id: product }, { onConflict: "user_id,product_id", ignoreDuplicates: true });
  } else {
    await supabase.from("favorites").delete().eq("user_id", user.id).eq("product_id", product);
  }
  revalidatePath(back);
  redirect(back);
}

/** Same, for the heart button: no page reload. Returns the new state, or "login". */
export async function setFavorite(productId: string, on: boolean): Promise<"on" | "off" | "login" | "error"> {
  if (!isUuid(productId)) return "error";
  const { user } = await getUser();
  if (!user) return "login";
  const supabase = await createClient();
  const { error } = on
    ? await supabase.from("favorites").upsert({ user_id: user.id, product_id: productId }, { onConflict: "user_id,product_id", ignoreDuplicates: true })
    : await supabase.from("favorites").delete().eq("user_id", user.id).eq("product_id", productId);
  return error ? "error" : on ? "on" : "off";
}
