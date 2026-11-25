import { NextResponse, type NextRequest } from "next/server";
import { ADDRESS_COOKIE } from "@/lib/address";
import { CART_COOKIE, LOCATION_COOKIE } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  // the cart and delivery address belong to the person who signed out; the next
  // person on this browser must not see them
  res.cookies.set(ADDRESS_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(LOCATION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(CART_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
