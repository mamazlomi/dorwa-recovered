// Dorva notification dispatcher (Supabase Edge Function).
// Sends queued push notifications (Web Push, RFC 8291 + VAPID, WebCrypto only)
// and SMS (Kavenegar). Called by the database through pg_net right after a
// notification is created, and every minute by pg_cron as a retry.
//
// GET  → { publicKey } (creates the VAPID key pair on first use; the private key never leaves the database)
// POST → processes up to 100 queued deliveries
//
// Secrets (Supabase › Edge Functions › Secrets): SMS_API_KEY for the SMS provider.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMS_API_KEY = Deno.env.get("SMS_API_KEY") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://dorva.vercel.app";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const enc = new TextEncoder();

// ---------------------------------------------------------------- base64url helpers
const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---------------------------------------------------------------- VAPID keys (stored in public.notify_keys)
type Keys = { publicKey: string; privateKey: CryptoKey };
let cached: Keys | null = null;

async function keys(): Promise<Keys> {
  if (cached) return cached;
  const { data } = await db.from("notify_keys").select("public_key, private_jwk").eq("id", 1).maybeSingle();
  if (data) {
    const privateKey = await crypto.subtle.importKey("jwk", data.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    cached = { publicKey: data.public_key, privateKey };
    return cached;
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  // another run may have won the race: keep whichever row exists
  await db.from("notify_keys").upsert({ id: 1, public_key: pub, private_jwk: jwk }, { onConflict: "id", ignoreDuplicates: true });
  cached = null;
  return keys();
}

async function vapidHeader(endpoint: string): Promise<string> {
  const k = await keys();
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.privateKey, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${k.publicKey}`;
}

// ---------------------------------------------------------------- RFC 8291 payload encryption (aes128gcm)
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

async function encrypt(payload: Uint8Array, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  // key derivation
  const prkKey = await hmac(auth, ecdh);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

type Sub = { endpoint: string; p256dh: string; auth: string };

async function sendPush(sub: Sub, data: Record<string, unknown>): Promise<"sent" | "gone" | "failed"> {
  try {
    const body = await encrypt(enc.encode(JSON.stringify(data)), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidHeader(sub.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: data.alarm ? "high" : "normal",
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch (e) {
    console.warn("push failed", String(e));
    return "failed";
  }
}

// ---------------------------------------------------------------- SMS
async function sendSms(provider: string, sender: string, phone: string, text: string): Promise<"sent" | "failed" | "no_provider"> {
  if (!SMS_API_KEY || provider !== "kavenegar") return "no_provider";
  const q = new URLSearchParams({ receptor: phone, message: text });
  if (sender) q.set("sender", sender);
  try {
    const res = await fetch(`https://api.kavenegar.com/v1/${encodeURIComponent(SMS_API_KEY)}/sms/send.json`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: q.toString(),
    });
    const j = await res.json().catch(() => null) as { return?: { status?: number } } | null;
    return res.ok && j?.return?.status === 200 ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

// ---------------------------------------------------------------- one run
type Item = {
  id: number; title: Record<string, string>; body: Record<string, string>; link: string | null; phone: string | null;
  alarm: boolean; push: boolean; sms: boolean; subs: Sub[];
};

async function run(): Promise<{ done: number }> {
  const { data, error } = await db.rpc("notify_claim", { p_limit: 100 });
  if (error) throw new Error(error.message);
  const items = (data?.items ?? []) as Item[];
  const sms = (data?.sms ?? {}) as { enabled?: boolean; provider?: string; sender?: string };
  for (const it of items) {
    let push: string | null = null;
    let smsStatus: string | null = null;
    const gone: string[] = [];
    if (it.push) {
      if (it.subs.length === 0) push = "failed";
      else {
        const payload = { title: it.title?.fa ?? "دوروا", body: it.body?.fa ?? "", link: it.link ?? "/fa", alarm: it.alarm, id: it.id };
        const results = await Promise.all(it.subs.map((s) => sendPush(s, payload)));
        results.forEach((r, i) => { if (r === "gone") gone.push(it.subs[i].endpoint); });
        push = results.includes("sent") ? "sent" : "failed";
      }
    }
    if (it.sms) {
      if (!sms.enabled) smsStatus = "no_provider";
      else if (!it.phone || !/^09\d{9}$/.test(it.phone)) smsStatus = "no_phone";
      else {
        const text = [it.title?.fa, it.body?.fa].filter(Boolean).join("\n").slice(0, 300);
        smsStatus = await sendSms(sms.provider ?? "none", sms.sender ?? "", it.phone, text);
      }
    }
    await db.rpc("notify_result", { p_id: it.id, p_push: push, p_sms: smsStatus, p_gone: gone });
  }
  return { done: items.length };
}

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (req.method === "GET") {
      const k = await keys();
      return Response.json({ publicKey: k.publicKey, sms: Boolean(SMS_API_KEY) }, { headers: cors });
    }
    return Response.json(await run(), { headers: cors });
  } catch (e) {
    console.error("dispatch error", String(e));
    return Response.json({ error: "dispatch failed" }, { status: 500, headers: cors });
  }
});
