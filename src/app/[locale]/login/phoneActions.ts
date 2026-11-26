"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n";
import { normalizePhone, requestCode, verifyCode } from "@/lib/phoneAuth";

function ctx(formData: FormData) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const n = String(formData.get("next") ?? "");
  const next = n.startsWith("/") && !n.startsWith("//") ? n : `/${locale}/account`;
  return { locale, next };
}
const back = (locale: string, next: string, extra: Record<string, string>) =>
  `/${locale}/login?${new URLSearchParams({ next, ...extra })}`;

export async function sendPhoneCode(formData: FormData) {
  const { locale, next } = ctx(formData);
  const phone = normalizePhone(String(formData.get("mobile") ?? ""));
  if (!phone) redirect(back(locale, next, { perror: "mobile" }));
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip");
  const r = await requestCode(phone, ip || null);
  // "wait" still moves to the code step: the earlier code is valid
  if (r === "ok" || r === "wait") redirect(back(locale, next, { phone, ...(r === "wait" ? { perror: "wait" } : {}) }));
  redirect(back(locale, next, { perror: r }));
}

export async function verifyPhoneCode(formData: FormData) {
  const { locale, next } = ctx(formData);
  const phone = normalizePhone(String(formData.get("mobile") ?? ""));
  if (!phone) redirect(back(locale, next, { perror: "mobile" }));
  const r = await verifyCode(phone, String(formData.get("code") ?? ""));
  if (r === "ok") redirect(next);
  redirect(back(locale, next, { phone, perror: r }));
}
