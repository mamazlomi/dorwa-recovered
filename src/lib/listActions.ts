"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** English and Arabic names of one catalog category (Persian name is the key). */
export async function saveCategoryName(fa: string, en: string, ar: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("category_name_save", { p_fa: fa, p_en: en.slice(0, 80), p_ar: ar.slice(0, 80) });
  if (error) return error.code === "42501" ? "forbidden" : "unknown";
  if (data === "ok") revalidatePath("/[locale]", "layout");
  return String(data);
}
