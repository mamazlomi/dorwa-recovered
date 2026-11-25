import { cookies } from "next/headers";
import { ADDRESS_COOKIE, isUuid, LOCATION_COOKIE } from "@/lib/cart";

// The active delivery address: always one of the signed-in customer's saved
// addresses (guests choose an address only after signing in).
export { ADDRESS_COOKIE };

export type ActiveAddress = { lat: number; lng: number; label: string; id?: string; city?: string };

export function inIran(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 24 && lat <= 40.5 && lng >= 44 && lng <= 63.5;
}

export async function readAddress(): Promise<ActiveAddress | null> {
  const raw = (await cookies()).get(ADDRESS_COOKIE)?.value;
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<ActiveAddress>;
    const lat = Number(a.lat), lng = Number(a.lng);
    if (!inIran(lat, lng) || !isUuid(a.id)) return null;
    return {
      lat, lng,
      label: String(a.label ?? "").slice(0, 40),
      id: isUuid(a.id) ? a.id : undefined,
      city: typeof a.city === "string" && /^[a-z0-9-]{1,40}$/.test(a.city) ? a.city : undefined,
    };
  } catch {
    return null;
  }
}

export async function writeAddress(a: (ActiveAddress & { id: string }) | null) {
  const jar = await cookies();
  const opts = { path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  if (!a) {
    jar.set(ADDRESS_COOKIE, "", { ...opts, maxAge: 0, httpOnly: true });
    jar.set(LOCATION_COOKIE, "", { ...opts, maxAge: 0 });
    return;
  }
  const lat = Number(a.lat.toFixed(5)), lng = Number(a.lng.toFixed(5));
  const maxAge = 60 * 60 * 24 * 180;
  jar.set(ADDRESS_COOKIE, JSON.stringify({ lat, lng, label: a.label.slice(0, 40), id: a.id, city: a.city }), { ...opts, maxAge, httpOnly: true });
  jar.set(LOCATION_COOKIE, "", { ...opts, maxAge: 0 }); // old GPS cookie, no longer used
}
