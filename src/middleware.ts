import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/i18n/config";

// Paths that are not localized pages.
const UNLOCALIZED = /^\/(auth|api|_next|favicon\.ico|robots\.txt|sitemap\.xml|manifest\.webmanifest|sw\.js|offline\.html|icons|brand)(\/|$)/;

// Redirects Dorva manages in admin › SEO (old addresses → new), cached for 5 minutes.
type Redirect = { f: string; t: string; p: boolean };
let redirectCache: { at: number; list: Redirect[] } = { at: 0, list: [] };
async function redirects(): Promise<Redirect[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || Date.now() - redirectCache.at < 300_000) return redirectCache.list;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/seo_redirect_list`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}",
      signal: AbortSignal.timeout(1500),
    });
    redirectCache = { at: Date.now(), list: res.ok ? ((await res.json()) as Redirect[]) : redirectCache.list };
  } catch {
    redirectCache = { ...redirectCache, at: Date.now() };
  }
  return redirectCache.list;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 0. Managed redirects (only for page addresses, never for the API or assets)
  if (!/^\/(api|_next|auth)(\/|$)/.test(pathname)) {
    let path = pathname;
    try { path = decodeURIComponent(pathname); } catch { /* keep raw */ }
    path = path.length > 1 ? path.replace(/\/$/, "") : path;
    const hit = (await redirects()).find((r) => r.f === path || r.f === pathname);
    if (hit) {
      const to = hit.t.startsWith("https://") ? hit.t : new URL(hit.t, request.url).toString();
      return NextResponse.redirect(to, hit.p ? 308 : 307);
    }
  }

  // 1. Every page lives under /fa, /en, /ar …; send bare paths to the best language.
  if (!UNLOCALIZED.test(pathname)) {
    const first = pathname.split("/")[1];
    if (!isLocale(first)) {
      // A bare address (dorva.ir, a shared link without /en) always opens in Persian.
      // Neither the browser language nor an earlier visit in English changes that:
      // testers found it confusing when the main address opened in English.
      const locale = DEFAULT_LOCALE;
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
      url.search = search;
      return NextResponse.redirect(url);
    }
  }

  // 2. Refresh the Supabase session cookie.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (supaUrl && key) {
    const supabase = createServerClient(supaUrl, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    await supabase.auth.getUser();
  }

  // 3. Remember the language the visitor is browsing in.
  const first = pathname.split("/")[1];
  if (isLocale(first) && request.cookies.get(LOCALE_COOKIE)?.value !== first) {
    response.cookies.set(LOCALE_COOKIE, first, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|offline.html|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|txt|xml)$).*)"],
};
