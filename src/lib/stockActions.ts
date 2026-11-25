"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type BulkItem = { product_id: string; quantity: number; discount_pct: number; price: number | null };
export type BulkResult = { ok: number; errors: { product_id: string | null; code: string; cap?: string | null }[] };

/** Saves many inventory rows at once; rows that break a rule come back as errors. */
export async function saveStockBulk(pharmacyId: string, items: BulkItem[]): Promise<BulkResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_bulk_save", { p_pharmacy: pharmacyId, p_items: items });
  if (error) return { ok: 0, errors: [{ product_id: null, code: error.code === "42501" ? "forbidden" : "unknown" }] };
  revalidatePath("/[locale]/pharmacy/dashboard", "page");
  return data as BulkResult;
}
