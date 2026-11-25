"use server";

import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { isUuid } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";

// Server actions for the medicine finder (patient report, pharmacy panel, Dorva admin).
function ctx(formData: FormData, fallback: string) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const b = String(formData.get("back") ?? "");
  const back = b.startsWith(`/${locale}/`) && !b.startsWith("//") ? b : `/${locale}${fallback}`;
  const go = (r: string): never => {
    const [path, hash] = back.split("#");
    redirect(`${path}${path.includes("?") ? "&" : "?"}r=${encodeURIComponent(r)}${hash ? `#${hash}` : ""}`);
  };
  return { locale, back, go };
}
const code = (e: { code?: string } | null, data: unknown) =>
  e ? (e.code === "42501" ? "forbidden" : "unknown") : typeof data === "string" ? data : typeof data === "number" ? `n${data}` : "ok";
const note = (f: FormData, k = "note") => String(f.get(k) ?? "").trim().slice(0, 300) || null;

// patient: "they didn't have it" (signed-in only; the database checks again)
export async function reportMissing(formData: FormData) {
  const { go, locale, back } = ctx(formData, "/finder");
  const drug = formData.get("drug_id"), ph = formData.get("pharmacy_id");
  if (!isUuid(drug) || !isUuid(ph)) go("unknown");
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect(`/${locale}/login?next=${encodeURIComponent(back)}`);
  const { data, error } = await supabase.rpc("finder_report", { p_drug: drug, p_pharmacy: ph, p_note: note(formData) });
  go(code(error, data));
}

// pharmacy: have / don't have / confirm again
export async function setFinderStock(formData: FormData) {
  const { go } = ctx(formData, "/pharmacy/finder");
  const drug = formData.get("drug_id"), ph = formData.get("pharmacy_id");
  if (!isUuid(drug) || !isUuid(ph)) go("unknown");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finder_set_stock", { p_pharmacy: ph, p_drug: drug, p_have: formData.get("have") === "1" });
  go(code(error, data) === "ok" ? "saved" : code(error, data));
}

export async function confirmAllFinder(formData: FormData) {
  const { go } = ctx(formData, "/pharmacy/finder");
  const ph = formData.get("pharmacy_id");
  if (!isUuid(ph)) go("unknown");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finder_confirm_all", { p_pharmacy: ph });
  go(code(error, data));
}

export async function suggestFinder(formData: FormData) {
  const { go } = ctx(formData, "/pharmacy/finder");
  const ph = formData.get("pharmacy_id"), product = formData.get("product_id");
  if (!isUuid(ph) || !isUuid(product)) go("product");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finder_suggest", { p_pharmacy: ph, p_product: product, p_note: note(formData) });
  go(code(error, data));
}

// Dorva: add / on / off, and suggestion decisions
export async function adminFinderSet(formData: FormData) {
  const { go } = ctx(formData, "/admin/finder");
  const product = formData.get("product_id");
  const act = String(formData.get("act") ?? "");
  if (!isUuid(product) || !["add", "on", "off"].includes(act)) go("unknown");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finder_admin_set", { p_product: product, p_action: act, p_note: note(formData) });
  go(code(error, data));
}

export async function adminFinderDecide(formData: FormData) {
  const { go } = ctx(formData, "/admin/finder");
  const id = formData.get("suggestion_id");
  if (!isUuid(id)) go("unknown");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finder_admin_decide", {
    p_suggestion: id, p_approve: formData.get("approve") === "1", p_note: note(formData),
  });
  go(code(error, data));
}
