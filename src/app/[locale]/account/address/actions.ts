"use server";

import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { isUuid } from "@/lib/cart";
import { inIran, readAddress, writeAddress } from "@/lib/address";
import { createClient, getUser } from "@/lib/supabase/server";

function ctx(formData: FormData) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const b = String(formData.get("back") ?? "");
  const back = b.startsWith("/") && !b.startsWith("//") ? b : "";
  const self = `/${locale}/account/address${back ? `?back=${encodeURIComponent(back)}` : ""}`;
  const fail = (code: string) => redirect(`${self}${self.includes("?") ? "&" : "?"}error=${code}`);
  return { locale, back, self, fail };
}

const text = (f: FormData, k: string, max: number) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v || null;
};

async function cityOf(lat: number, lng: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("nearest_city", { p_lat: lat, p_lng: lng });
  const c = (data as { id: number; slug: string }[] | null)?.[0];
  return c ?? null;
}

/** Signed-in: save to the address book and make it the active address. */
export async function saveAddress(formData: FormData) {
  const { locale, back, fail } = ctx(formData);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/address`)}`);
  const lat = Number(formData.get("lat")), lng = Number(formData.get("lng"));
  if (!inIran(lat, lng)) fail("point");
  const supabase = await createClient();
  const { data, error } = await supabase.from("customer_addresses").insert({
    label: text(formData, "label", 40) ?? "-",
    recipient: text(formData, "recipient", 80),
    phone: text(formData, "phone", 16)?.replace(/[^0-9+ ]/g, "") || null,
    address_line: text(formData, "address_line", 300),
    plaque: text(formData, "plaque", 20),
    unit: text(formData, "unit", 20),
    lat, lng,
  }).select("id, label, lat, lng, city_id").single();
  if (error || !data) fail(error?.message.includes("full") ? "full" : "save");
  const row = data as { id: string; label: string; lat: number; lng: number; city_id: number | null };
  const city = await cityOf(row.lat, row.lng);
  await writeAddress({ lat: row.lat, lng: row.lng, label: row.label, id: row.id, city: city?.slug });
  redirect(back || `/${locale}/products`);
}

/** Signed-in: edit a saved address; the active address follows the change. */
export async function updateAddress(formData: FormData) {
  const { locale, back, fail } = ctx(formData);
  const id = formData.get("id");
  if (!isUuid(id)) fail("save");
  const lat = Number(formData.get("lat")), lng = Number(formData.get("lng"));
  if (!inIran(lat, lng)) fail("point");
  const supabase = await createClient();
  const { data, error } = await supabase.from("customer_addresses").update({
    label: text(formData, "label", 40) ?? "-",
    recipient: text(formData, "recipient", 80),
    phone: text(formData, "phone", 16)?.replace(/[^0-9+ ]/g, "") || null,
    address_line: text(formData, "address_line", 300),
    plaque: text(formData, "plaque", 20),
    unit: text(formData, "unit", 20),
    city_id: null, // recomputed from the (possibly moved) pin
    lat, lng,
  }).eq("id", id as string).select("id, label, lat, lng").maybeSingle();
  if (error || !data) fail("save");
  const row = data as { id: string; label: string; lat: number; lng: number };
  if ((await readAddress())?.id === row.id) {
    const city = await cityOf(row.lat, row.lng);
    await writeAddress({ lat: row.lat, lng: row.lng, label: row.label, id: row.id, city: city?.slug });
  }
  redirect(back || `/${locale}/account/address`);
}

/** Signed-in: pick one of the saved addresses. */
export async function selectAddress(formData: FormData) {
  const { locale, back, fail } = ctx(formData);
  const id = formData.get("id");
  if (!isUuid(id)) fail("save");
  const supabase = await createClient();
  const { data } = await supabase.from("customer_addresses").select("id, label, lat, lng").eq("id", id as string).maybeSingle();
  if (!data) fail("save");
  const row = data as { id: string; label: string; lat: number; lng: number };
  const city = await cityOf(row.lat, row.lng);
  await writeAddress({ lat: row.lat, lng: row.lng, label: row.label, id: row.id, city: city?.slug });
  redirect(back || `/${locale}/products`);
}

export async function deleteAddress(formData: FormData) {
  const { self } = ctx(formData);
  const h = String(formData.get("here") ?? "");
  const here = h.startsWith("/") && !h.startsWith("//") ? h : self;
  const id = formData.get("id");
  if (isUuid(id)) {
    const supabase = await createClient();
    await supabase.from("customer_addresses").delete().eq("id", id);
    if ((await readAddress())?.id === id) await writeAddress(null);
  }
  redirect(here);
}

export async function clearAddress(formData: FormData) {
  const { self } = ctx(formData);
  await writeAddress(null);
  redirect(self);
}
