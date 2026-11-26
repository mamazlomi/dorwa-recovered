import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/sms";

export const OTP_LENGTH = 5;
const TTL_MS = 2 * 60_000;       // a code lives 2 minutes
const RESEND_MS = 60_000;        // one code per number per minute
const MAX_PER_HOUR_PHONE = 5;
const MAX_PER_HOUR_IP = 20;
const MAX_ATTEMPTS = 5;

const FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";

/** "۰۹۱۲ 345 6789", "+98 912…", "0098912…" → "09123456789", or null. */
export function normalizePhone(raw: string): string | null {
  let s = raw.replace(/[۰-۹]/g, (c) => String(FA.indexOf(c))).replace(/[٠-٩]/g, (c) => String(AR.indexOf(c))).replace(/[\s\-().]/g, "");
  if (s.startsWith("+98")) s = "0" + s.slice(3);
  else if (s.startsWith("0098")) s = "0" + s.slice(4);
  else if (/^9\d{9}$/.test(s)) s = "0" + s;
  return /^09\d{9}$/.test(s) ? s : null;
}

export function normalizeCode(raw: string): string {
  return raw.replace(/[۰-۹]/g, (c) => String(FA.indexOf(c))).replace(/[٠-٩]/g, (c) => String(AR.indexOf(c))).replace(/\D/g, "");
}

const secret = () => process.env.OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hash = (phone: string, code: string) => createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");

export type SendResult = "ok" | "config" | "wait" | "limit" | "sms";

export async function requestCode(phone: string, ip: string | null): Promise<SendResult> {
  const db = createAdminClient();
  if (!db || !secret()) return "config";
  const now = Date.now();
  const hourAgo = new Date(now - 3_600_000).toISOString();

  const { data: recent } = await db.from("phone_otps").select("created_at").eq("phone", phone).gte("created_at", hourAgo).order("created_at", { ascending: false });
  if (recent && recent.length) {
    if (now - new Date(recent[0].created_at as string).getTime() < RESEND_MS) return "wait";
    if (recent.length >= MAX_PER_HOUR_PHONE) return "limit";
  }
  if (ip) {
    const { count } = await db.from("phone_otps").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", hourAgo);
    if ((count ?? 0) >= MAX_PER_HOUR_IP) return "limit";
  }

  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  const { error } = await db.from("phone_otps").insert({
    phone, code_hash: hash(phone, code), ip, expires_at: new Date(now + TTL_MS).toISOString(),
  });
  if (error) return "config";

  const sent = await sendSms(phone, `کد ورود دوروا: ${code}\nاین کد را به کسی نگویید.`);
  if (sent === "no_provider" && process.env.NODE_ENV !== "production") {
    console.warn(`[dev] SMS code for ${phone}: ${code}`); // local testing only
    return "ok";
  }
  return sent === "sent" ? "ok" : "sms";
}

export type VerifyResult = "ok" | "config" | "invalid" | "expired" | "attempts" | "session";

const phoneEmail = (phone: string) => `p${phone.slice(1)}@phone.dorva.ir`;

/** Checks the code; on success creates (or finds) the account for that number and starts the session. */
export async function verifyCode(phone: string, rawCode: string): Promise<VerifyResult> {
  const db = createAdminClient();
  if (!db || !secret()) return "config";
  const code = normalizeCode(rawCode);
  if (code.length !== OTP_LENGTH) return "invalid";

  const { data: row } = await db.from("phone_otps").select("id, code_hash, attempts, expires_at")
    .eq("phone", phone).is("consumed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) return "expired";
  if (new Date(row.expires_at as string).getTime() < Date.now()) return "expired";
  if ((row.attempts as number) >= MAX_ATTEMPTS) return "attempts";

  const a = Buffer.from(hash(phone, code), "hex"), b = Buffer.from(row.code_hash as string, "hex");
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    await db.from("phone_otps").update({ attempts: (row.attempts as number) + 1 }).eq("id", row.id);
    return "invalid";
  }
  // single use: claim it atomically so two parallel requests cannot both succeed
  const { data: claimed } = await db.from("phone_otps").update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id).is("consumed_at", null).select("id");
  if (!claimed || !claimed.length) return "invalid";

  // The account is keyed by a synthetic e-mail built from the verified number (not by profiles.mobile,
  // which a user can type freely), so nobody can reach another person's account by claiming a number.
  const email = phoneEmail(phone);
  let link = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data?.properties?.hashed_token) {
    const created = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { mobile: phone, via: "sms" } });
    if (created.error || !created.data.user) return "session";
    // best effort: remember the number on the profile when it is free
    await db.from("profiles").upsert({ id: created.data.user.id, mobile: phone }, { onConflict: "id", ignoreDuplicates: true });
    link = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error || !link.data?.properties?.hashed_token) return "session";
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  return error ? "session" : "ok";
}
