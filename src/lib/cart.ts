import { cookies } from "next/headers";

// The cart lives in a cookie so guests can shop without an account;
// login is only required at checkout. Prices are never stored here:
// they are always recomputed from the database.
export const CART_COOKIE = "dorva_cart";
export const LOCATION_COOKIE = "dorva_loc";
const MAX_LINES = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CartLine = { p: string; q: number };
export type Cart = { items: CartLine[]; pref?: string };

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

function sanitize(raw: unknown): Cart {
  const c = (raw ?? {}) as Partial<Cart>;
  const items = Array.isArray(c.items) ? c.items : [];
  const seen = new Map<string, number>();
  for (const l of items) {
    if (!l || !isUuid(l.p)) continue;
    const q = Math.min(Math.max(Math.trunc(Number(l.q) || 0), 0), 99);
    if (q > 0) seen.set(l.p, Math.min((seen.get(l.p) ?? 0) + q, 99));
  }
  return {
    items: [...seen].slice(0, MAX_LINES).map(([p, q]) => ({ p, q })),
    pref: isUuid(c.pref) ? c.pref : undefined,
  };
}

export async function readCart(): Promise<Cart> {
  const raw = (await cookies()).get(CART_COOKIE)?.value;
  if (!raw) return { items: [] };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { items: [] };
  }
}

export async function writeCart(cart: Cart) {
  const clean = sanitize(cart);
  (await cookies()).set(CART_COOKIE, JSON.stringify(clean), {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

// The delivery point comes only from a saved address of a signed-in customer
// (the address cookie written by lib/address). Guests have no location.
export const ADDRESS_COOKIE = "dorva_addr";
export async function readLocation(): Promise<{ lat: number; lng: number } | null> {
  const raw = (await cookies()).get(ADDRESS_COOKIE)?.value;
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as { lat?: unknown; lng?: unknown; id?: unknown };
    const lat = Number(a.lat), lng = Number(a.lng);
    if (!isUuid(a.id) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < 24 || lat > 40.5 || lng < 44 || lng > 63.5) return null; // Iran bounding box
    return { lat, lng };
  } catch {
    return null;
  }
}

export function cartCount(cart: Cart) {
  return cart.items.reduce((s, l) => s + l.q, 0);
}

export function toRpcItems(cart: Cart) {
  return cart.items.map((l) => ({ product_id: l.p, qty: l.q }));
}
