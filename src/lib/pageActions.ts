"use server";

import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { isUuid } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";

const code = (e: { code?: string } | null, data: unknown) =>
  e ? (e.code === "42501" ? "forbidden" : "unknown") : typeof data === "string" ? data : "unknown";

// Called from the page builder. pharmacy null = Dorva home page.
export async function savePage(pharmacy: string | null, blocks: unknown): Promise<string> {
  if (pharmacy !== null && !isUuid(pharmacy)) return "unknown";
  if (!Array.isArray(blocks)) return "block";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("page_save", { p_pharmacy: pharmacy, p_blocks: blocks });
  return code(error, data);
}

export async function publishPage(pharmacy: string | null, blocks: unknown): Promise<string> {
  const saved = await savePage(pharmacy, blocks);
  if (saved !== "ok") return saved;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("page_publish", { p_pharmacy: pharmacy });
  return code(error, data);
}

// Dorva review form: approve | reject | unpublish
export async function reviewPage(formData: FormData) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const ph = formData.get("pharmacy_id");
  const act = String(formData.get("act") ?? "");
  if (!isUuid(ph) || !["approve", "reject", "unpublish"].includes(act)) redirect(`/${locale}/admin/pages?r=unknown`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("page_review", {
    p_pharmacy: ph, p_action: act, p_note: String(formData.get("note") ?? "").slice(0, 500) || null,
  });
  redirect(`/${locale}/admin/pages?r=${encodeURIComponent(code(error, data))}`);
}
