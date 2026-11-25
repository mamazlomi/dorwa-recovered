"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { isUuid } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COOKIE } from "@/lib/theme";

const loc = (f: FormData) => { const r = String(f.get("locale") ?? "fa"); return isLocale(r) ? r : "fa"; };
const code = (e: { code?: string } | null, data: unknown) =>
  e ? (e.code === "42501" ? "forbidden" : "unknown") : typeof data === "string" ? data : "unknown";

// ---------------------------------------------------------------- live editor (called from the studio)
export async function startThemePreview(id: string) {
  if (!isUuid(id)) return;
  (await cookies()).set(PREVIEW_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 3 });
}
export async function stopThemePreview(formData?: FormData) {
  (await cookies()).delete(PREVIEW_COOKIE);
  if (formData) redirect(String(formData.get("back") ?? "/").startsWith("/") ? String(formData.get("back")) : "/");
}
export async function saveThemeDraft(id: string, name: string | null, draft: unknown): Promise<string> {
  if (!isUuid(id)) return "unknown";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("theme_save", { p_theme: id, p_name: name, p_draft: draft });
  return code(error, data);
}
export async function publishTheme(id: string): Promise<string> {
  if (!isUuid(id)) return "unknown";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("theme_publish", { p_theme: id });
  revalidatePath("/", "layout");
  return code(error, data);
}
export async function discardThemeDraft(id: string): Promise<string> {
  if (!isUuid(id)) return "unknown";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("theme_discard", { p_theme: id });
  return code(error, data);
}

// ---------------------------------------------------------------- theme list page (forms)
export async function createTheme(formData: FormData) {
  const locale = loc(formData);
  const from = formData.get("from");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("theme_create", {
    p_name: String(formData.get("name") ?? "").trim().slice(0, 60), p_from: isUuid(from) ? from : null,
  });
  if (error || !data) redirect(`/${locale}/admin/theme?r=${error?.code === "22023" ? "name" : "unknown"}`);
  redirect(`/${locale}/admin/theme/${data}`);
}
export async function themeAction(formData: FormData) {
  const locale = loc(formData);
  const id = formData.get("id");
  const act = String(formData.get("act") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/theme?r=unknown`);
  const supabase = await createClient();
  const fn = act === "default" ? "theme_set_default" : act === "delete" ? "theme_delete" : act === "publish" ? "theme_publish" : null;
  if (!fn) redirect(`/${locale}/admin/theme?r=unknown`);
  const { data, error } = await supabase.rpc(fn, { p_theme: id });
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin/theme?r=${encodeURIComponent(code(error, data))}`);
}
export async function addSchedule(formData: FormData) {
  const locale = loc(formData);
  const id = formData.get("theme_id");
  // datetime-local values are Tehran time
  const ts = (k: string) => { const v = String(formData.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+03:30` : null; };
  if (!isUuid(id)) redirect(`/${locale}/admin/theme?r=unknown#schedule`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("theme_schedule_add", {
    p_theme: id, p_starts: ts("starts"), p_ends: ts("ends"), p_note: String(formData.get("note") ?? "").slice(0, 120) || null,
  });
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin/theme?r=${encodeURIComponent(code(error, data))}#schedule`);
}
export async function deleteSchedule(formData: FormData) {
  const locale = loc(formData);
  const id = formData.get("id");
  if (isUuid(id)) {
    const supabase = await createClient();
    await supabase.rpc("theme_schedule_delete", { p_id: id });
  }
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin/theme?r=done#schedule`);
}
export async function reviewLook(formData: FormData) {
  const locale = loc(formData);
  const ph = formData.get("pharmacy_id");
  const act = String(formData.get("act") ?? "");
  if (!isUuid(ph)) redirect(`/${locale}/admin/theme?r=unknown#looks`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacy_look_review", {
    p_pharmacy: ph, p_action: act, p_note: String(formData.get("note") ?? "").slice(0, 500) || null,
  });
  redirect(`/${locale}/admin/theme?r=${encodeURIComponent(code(error, data))}#looks`);
}

// ---------------------------------------------------------------- pharmacy look
export async function savePharmacyLook(pharmacy: string, draft: unknown, submit: boolean): Promise<string> {
  if (!isUuid(pharmacy)) return "unknown";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacy_look_save", { p_pharmacy: pharmacy, p_draft: draft, p_submit: submit });
  return code(error, data);
}
