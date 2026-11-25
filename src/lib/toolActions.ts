"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CodeHit = { product_id: string; name_fa: string; gtin: string | null; irc: string | null; source: string; quantity: number | null; image_url: string | null };

export async function lookupCode(pharmacyId: string, code: string): Promise<CodeHit[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("product_by_code", { p_code: code, p_pharmacy: pharmacyId });
  return (data as CodeHit[] | null) ?? [];
}

export async function receiveStock(pharmacyId: string, productId: string, qty: number, batch: string, expiry: string, uid: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_receive", {
    p_pharmacy: pharmacyId, p_product: productId, p_qty: Math.round(qty),
    p_batch: batch.trim() || null, p_expiry: /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null, p_uid: uid.trim() || null,
  });
  if (error) return error.code === "42501" ? "forbidden" : "unknown";
  revalidatePath("/[locale]/pharmacy/dashboard", "page");
  return String(data);
}

export async function suggestCode(pharmacyId: string, code: string, productId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("code_suggest", { p_pharmacy: pharmacyId, p_code: code, p_product: productId });
  if (error) return error.code === "42501" ? "forbidden" : "unknown";
  return String(data);
}

export async function reviewCodes(ids: string[], approve: boolean, note: string): Promise<{ n: number; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("code_review", { p_ids: ids, p_approve: approve, p_note: note || null });
  if (error) return { n: 0, error: error.code === "42501" ? "forbidden" : "unknown" };
  revalidatePath("/[locale]", "layout");
  return { n: Number(data) };
}
