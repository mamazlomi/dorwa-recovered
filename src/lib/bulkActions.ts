"use server";

import { revalidatePath } from "next/cache";
import type { GridResult, GridSaveItem } from "@/components/BulkGrid";
import { createClient } from "@/lib/supabase/server";

const fail = (code?: string): GridResult => ({ ok: 0, errors: [{ id: null, code: code === "42501" ? "forbidden" : "unknown" }] });

/** Dorva panel › prices & publishing. Prices arrive in Toman and are stored in Rial. */
export async function saveListings(items: GridSaveItem[]): Promise<GridResult> {
  const payload = items.map((it) => {
    const o: Record<string, unknown> = { id: it.id };
    const v = it.values;
    if ("published" in v) o.is_published = v.published === true;
    if ("price" in v) o.base_price = v.price == null ? null : String(Math.round(Number(v.price)) * 10);
    if ("policy" in v) o.price_policy = v.policy;
    if ("cap" in v) o.product_cap = v.cap == null ? null : String(v.cap);
    return o;
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("listing_bulk_save", { p_items: payload });
  if (error) return fail(error.code);
  revalidatePath("/[locale]", "layout");
  return data as GridResult;
}

/** Dorva panel › products hub: listing fields plus Dorva product settings. Prices arrive in Toman, stored in Rial. */
export async function saveProducts(items: GridSaveItem[]): Promise<GridResult> {
  const rial = (v: unknown) => (v == null ? null : String(Math.round(Number(v)) * 10));
  const payload = items.map((it) => {
    const o: Record<string, unknown> = { id: it.id };
    const v = it.values;
    if ("published" in v) o.is_published = v.published === true;
    if ("price" in v) o.base_price = rial(v.price);
    if ("policy" in v) o.price_policy = v.policy;
    if ("cap" in v) o.product_cap = v.cap == null ? null : String(v.cap);
    if ("min" in v) o.min_price = rial(v.min);
    if ("maxq" in v) o.max_per_order = v.maxq == null ? null : String(Math.round(Number(v.maxq)));
    if ("comm" in v) o.commission_pct = v.comm == null ? null : String(v.comm);
    if ("tech" in v) o.tech_approval = v.tech == null ? null : v.tech;
    if ("badge" in v) o.badge = v.badge == null ? null : v.badge;
    if ("pappr" in v) o.price_approval = v.pappr == null ? null : v.pappr;
    return o;
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("product_admin_save", { p_items: payload });
  if (error) return fail(error.code);
  revalidatePath("/[locale]", "layout");
  return data as GridResult;
}

/** Dorva panel › discount caps: percent and active state of existing caps. */
export async function saveCaps(items: GridSaveItem[]): Promise<GridResult> {
  const payload = items.map((it) => {
    const o: Record<string, unknown> = { id: it.id };
    if ("pct" in it.values) o.max_discount_pct = it.values.pct == null ? "" : String(it.values.pct);
    if ("active" in it.values) o.is_active = it.values.active === true;
    return o;
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discount_caps_bulk", { p_items: payload });
  if (error) return fail(error.code);
  revalidatePath("/[locale]", "layout");
  return data as GridResult;
}

/** Approve (for this pharmacy or all) or reject pharmacy price requests. */
export async function decidePrices(ids: string[], approve: boolean, scope: "this" | "all", note: string): Promise<{ n: number; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("price_requests_decide", { p_stock: ids, p_approve: approve, p_note: note || null, p_scope: scope });
  if (error) return { n: 0, error: error.code === "42501" ? "forbidden" : error.message === "note" ? "note" : "unknown" };
  revalidatePath("/[locale]", "layout");
  return { n: Number(data) };
}
