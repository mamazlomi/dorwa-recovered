"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { isUuid } from "@/lib/cart";
import { SITE_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

// Server actions for staff management, shared by the pharmacy and Dorva staff pages.
function ctx(formData: FormData) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const b = String(formData.get("back") ?? "");
  const back = b.startsWith(`/${locale}/`) && !b.startsWith("//") ? b : `/${locale}/account`;
  const ph = formData.get("pharmacy_id");
  const go = (r: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}r=${encodeURIComponent(r)}`);
  return { go, locale, pharmacy: isUuid(ph) ? ph : null };
}
const reason = (e: { code?: string } | null, data: unknown) =>
  e ? (e.code === "42501" ? "forbidden" : "unknown") : typeof data === "string" ? data : "done";

// The invitation e-mail is Supabase's sign-in link: it creates the account if
// needed and lands on "My account", where the invitation waits. A separate,
// session-less client is used so the manager's own session is untouched.
async function sendInviteMail(email: string, locale: string) {
  const origin = (await headers()).get("origin") ?? SITE_URL;
  const anon = createStatelessClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(`/${locale}/account`)}` },
  });
  return !error;
}

export async function inviteStaff(formData: FormData) {
  const { go, pharmacy, locale } = ctx(formData);
  const raw = formData.get("role_id");
  const role = isUuid(raw) ? raw : null;   // empty = no access until ticked
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_invite", {
    p_pharmacy: pharmacy, p_role: role, p_email: email,
    p_license: String(formData.get("license") ?? "") || null, p_note: String(formData.get("note") ?? "") || null,
  });
  const r = reason(error, data);
  if (r !== "ok") go(r);
  go((await sendInviteMail(email, locale)) ? "ok" : "nomail");
}

export async function revokeInvite(formData: FormData) {
  const { go } = ctx(formData);
  const id = formData.get("invite_id");
  if (!isUuid(id)) go("unknown");
  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_invite_revoke", { p_invite: id });
  go(reason(error, "done"));
}

export async function updateStaff(formData: FormData) {
  const { go } = ctx(formData);
  const id = formData.get("membership_id");
  const act = String(formData.get("act") ?? "");
  if (!isUuid(id) || !["remove", "disable", "enable", "role"].includes(act)) go("unknown");
  const role = formData.get("role_id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_update", {
    p_membership: id, p_action: act, p_role: isUuid(role) ? role : null,
    p_license: String(formData.get("license") ?? "") || null,
  });
  const r = reason(error, data);
  go(r === "ok" ? "done" : r);
}

export async function answerInvite(formData: FormData) {
  const { go } = ctx(formData);
  const id = formData.get("invite_id");
  if (!isUuid(id)) go("unknown");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_invite_answer", { p_invite: id, p_accept: formData.get("accept") === "1" });
  go(reason(error, data));
}

export async function decideHoldingLink(formData: FormData) {
  const { go } = ctx(formData);
  const id = formData.get("link_id");
  const act = String(formData.get("act") ?? "");
  if (!isUuid(id) || !["approve", "reject", "revoke"].includes(act)) go("unknown");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("holding_link_decide", { p_link: id, p_action: act });
  const r = reason(error, data);
  go(r === "ok" ? "done" : r);
}

export async function setStaffAccess(formData: FormData) {
  const { go } = ctx(formData);
  const id = formData.get("membership_id");
  if (!isUuid(id)) go("unknown");
  const role = formData.get("role_id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_set_access", {
    p_membership: id, p_role: isUuid(role) ? role : null,
    p_perms: formData.getAll("perm").map(String).filter((x) => /^[a-z_.]{3,60}$/.test(x)),
    p_license: String(formData.get("license") ?? "") || null,
  });
  const r = reason(error, data);
  go(r === "ok" ? "access_ok" : `access_${r}`);
}

export async function saveMyStaffProfile(profile: Record<string, unknown>): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_profile_save", { p: profile });
  return error ? "value" : String(data);
}
