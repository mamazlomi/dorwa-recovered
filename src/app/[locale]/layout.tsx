import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Lalezar, Noto_Kufi_Arabic, Noto_Naskh_Arabic, Readex_Pro, Vazirmatn } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "../globals.css";
import { DeliverTo } from "@/components/DeliverTo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { HeaderSearch } from "@/components/HeaderSearch";
import { Dropdown } from "@/components/Dropdown";
import { ThemePreviewListener } from "@/components/ThemePreviewListener";
import { AppSupport } from "@/components/AppSupport";
import { BottomNav } from "@/components/BottomNav";
import { FormMessages } from "@/components/FormMessages";
import { Shape } from "@/components/Shapes";
import { SiteTools } from "@/components/SiteTools";
import { getRound4Texts } from "@/i18n/dictionaries/round4";
import { getRound6Texts } from "@/i18n/dictionaries/round6";
import { createClient } from "@/lib/supabase/server";
import { loadSeo, SITE_URL } from "@/lib/seo";
import { NotifyBell } from "@/components/NotifyBell";
import { getNotifyTexts } from "@/i18n/dictionaries/notify";
import { formatNumber, getDictionary, isLocale, LOCALE_CODES, LOCALES, resolveLocale, type Locale } from "@/i18n";
import { isConfigured } from "@/lib/config";
import { getUser } from "@/lib/supabase/server";
import { cartCount, readCart } from "@/lib/cart";
import { getAddressTexts } from "@/i18n/dictionaries/address";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { readAddress } from "@/lib/address";
import { loadTheme, themeAttrs, themeCss, type Theme } from "@/lib/theme";
import { stopThemePreview } from "@/lib/themeActions";
import { myRoles, type Tab } from "@/lib/roles";
import { titleOf } from "@/lib/collections";
import { mediaUrl, tr } from "@/lib/pageBlocks";

const vazirmatn = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-vazirmatn", display: "swap" });
// alternative fonts: only downloaded when a theme uses them
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "700"], variable: "--font-plex", display: "swap", preload: false });
const kufi = Noto_Kufi_Arabic({ subsets: ["arabic", "latin"], variable: "--font-kufi", display: "swap", preload: false });
const readex = Readex_Pro({ subsets: ["arabic", "latin"], variable: "--font-readex", display: "swap", preload: false });
const naskh = Noto_Naskh_Arabic({ subsets: ["arabic"], variable: "--font-naskh", display: "swap", preload: false });
const lalezar = Lalezar({ subsets: ["arabic", "latin"], weight: "400", variable: "--font-lalezar", display: "swap", preload: false });
const FONT_VARS = [vazirmatn, plex, kufi, readex, naskh, lalezar].map((f) => f.variable).join(" ");

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const l: Locale = isLocale(locale) ? locale : "fa";
  const t = getDictionary(l);
  const seo = await loadSeo(null);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.title, template: `%s | ${seo.suffix || t.brand}` },
    description: seo.description[l] || t.meta.description,
    alternates: { languages: Object.fromEntries(LOCALE_CODES.map((x) => [x, `/${x}`])) },
    // pages without their own SEO data stay out of search engines until indexing is on
    robots: seo.indexing ? { index: true, follow: true } : { index: false, follow: false },
    verification: { ...(seo.google ? { google: seo.google } : {}), ...(seo.bing ? { other: { "msvalidate.01": seo.bing } } : {}) },
    appleWebApp: { capable: true, title: t.brand, statusBarStyle: "default" },
    icons: { icon: [{ url: "/icons/icon-48.png", sizes: "48x48" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = { themeColor: "#0e76a8", viewportFit: "cover" };

function Logo({ locale, brand, theme }: { locale: Locale; brand: string; theme: Theme }) {
  const src = theme.logo.image ? mediaUrl(theme.logo.image) : "/brand/dorva-logo.png";
  const text = tr(theme.logo.text, locale) || brand;
  return (
    <Link href={`/${locale}`} className="flex shrink-0 items-center gap-2" aria-label={brand}>
      {theme.logo.mode !== "text" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={theme.logo.mode === "image" ? text : ""} style={{ height: "var(--logo-h)" }} className="w-auto" />
      )}
      {theme.logo.mode !== "image" && <span className="text-2xl font-extrabold text-brand-600">{text}</span>}
    </Link>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const USER = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0";
const BAG = "M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Zm4 0V6a3 3 0 0 1 6 0v2";
const MENU = "M4 7h16M4 12h16M4 17h16";
const TONE = {
  brand: "bg-brand-600 text-white", accent: "bg-accent-600 text-white", dark: "bg-slate-900 text-white",
  amber: "bg-amber-400 text-amber-950", rose: "bg-rose-600 text-white",
} as const;

async function Header({ locale, theme }: { locale: Locale; theme: Theme }) {
  const t = getDictionary(locale);
  const L = getLookTexts(locale);
  const H = theme.header;
  const [{ user }, cart, addr] = await Promise.all([
    isConfigured ? getUser() : Promise.resolve({ user: null }),
    readCart(),
    readAddress(),
  ]);
  const roles = isConfigured ? await myRoles(user?.id ?? null) : { pharmacy: false, platform: false, tabs: [] as Tab[] };
  // reminder for Dorva staff: how much waits in the approval inbox
  const waiting = roles.platform
    ? Object.values(((await (await createClient()).rpc("approval_inbox")).data as Record<string, number> | null) ?? {}).reduce((x, n) => x + Number(n || 0), 0)
    : 0;
  const tabs = H.categories ? roles.tabs : [];
  const inCart = cartCount(cart);
  const at = getAddressTexts(locale);
  const item = "block rounded-lg px-3 py-2 hover:bg-brand-50";
  const stacked = H.style === "stacked";
  const navLink = `shrink-0 whitespace-nowrap rounded-lg px-3 py-2 ${stacked ? "hover:bg-white/15" : "hover:bg-brand-50 hover:text-brand-700"}`;
  const announce = H.announce.on && tr(H.announce.text, locale);

  const search = (
    <Suspense fallback={null}><HeaderSearch locale={locale} placeholder={L.search} button={L.searchBtn} kinds={L.kinds} /></Suspense>
  );
  const account = user ? (
    <Dropdown summaryClass="flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-line px-3 py-2 hover:border-brand-500"
      summary={<><Icon d={USER} /><span className="hidden sm:inline">{L.account}</span>
        {waiting > 0 && <span aria-label={getRound6Texts(locale).inbox.bell.replace("{n}", String(waiting))} className="grid min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{waiting}</span>}</>}>
      <div className="absolute end-0 z-40 mt-2 w-60 rounded-2xl border border-line bg-white p-2 shadow-lg">
        <p className="truncate px-3 py-1 text-xs text-muted" dir="ltr">{user.email}</p>
        <Link href={`/${locale}/account`} className={item}>{L.account}</Link>
        <Link href={`/${locale}/account/orders`} className={item}>{L.myOrders}</Link>
        {(roles.pharmacy || roles.platform) && (
          <>
            <hr className="my-1 border-line" />
            <Link href={`/${locale}/pharmacy/dashboard`} className={item}>{L.pharmacyPanel}</Link>
            <Link href={`/${locale}/pharmacy/orders`} className={item}>{L.pharmacyOrders}</Link>
          </>
        )}
        {roles.platform && (
          <>
            <hr className="my-1 border-line" />
            <Link href={`/${locale}/admin/dashboard`} className={item}>{L.adminPanel}</Link>
            <Link href={`/${locale}/admin/inbox`} className={`${item} flex items-center justify-between`}>{getRound6Texts(locale).inbox.tab}
              {waiting > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{waiting}</span>}</Link>
          </>
        )}
        <hr className="my-1 border-line" />
        <form action="/auth/signout" method="post"><button className={`${item} w-full text-start text-red-700`}>{L.logout}</button></form>
      </div>
    </Dropdown>
  ) : (
    <Link href={`/${locale}/login`} className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 hover:border-brand-500">
      <Icon d={USER} /><span className="hidden sm:inline">{L.loginRegister}</span>
    </Link>
  );
  const actions = (
    <div className="flex items-center gap-2 text-sm">
      {H.deliverTo && (
        <div className="hidden lg:block">
          <Suspense fallback={null}>
            <DeliverTo locale={locale} title={at.deliverTo} guest={!user} label={user && addr ? addr.label || at.tempLabel : at.pickAddress} />
          </Suspense>
        </div>
      )}
      {user && <NotifyBell locale={locale} T={getNotifyTexts(isLocale(locale) ? locale : "fa")} supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} />}
      {account}
      <Link href={`/${locale}/cart`} aria-label={L.cart} className="relative flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 hover:border-brand-500">
        <Icon d={BAG} /><span className="hidden sm:inline">{L.cart}</span>
        {inCart > 0 && <span className="absolute -top-2 -start-2 min-w-5 rounded-full bg-accent-600 px-1.5 text-center text-xs leading-5 text-white">{formatNumber(inCart, locale)}</span>}
      </Link>
    </div>
  );
  const links = (
    <>
      <Link href={`/${locale}/products?col=all`} className={`${navLink} font-semibold`}>{L.allProducts}</Link>
      {tabs.map((x) => <Link key={x.slug} href={`/${locale}/products?col=${x.slug}`} className={navLink}>{titleOf(x.title, locale)}</Link>)}
      {H.finder && <Link href={`/${locale}/finder`} className={navLink}>{L.finder}</Link>}
      <Link href={`/${locale}/pharmacies`} className={navLink}>{L.pharmacies}</Link>
    </>
  );
  const lang = H.language && <Suspense fallback={null}><LanguageSwitcher current={locale} label={t.nav.language} /></Suspense>;

  return (
    <header className={`${H.sticky ? "sticky top-0" : ""} z-30 border-b border-line bg-white/95 backdrop-blur`}>
      {announce && (
        <div className={`${TONE[H.announce.tone as keyof typeof TONE] ?? TONE.brand} text-center text-sm`}>
          {H.announce.link
            ? <Link href={`/${locale}${H.announce.link === "/" ? "" : H.announce.link}`} className="wrap block py-2 font-medium hover:underline">{announce}</Link>
            : <p className="wrap py-2 font-medium">{announce}</p>}
        </div>
      )}

      {H.style === "compact" ? (
        <div className="wrap flex items-center gap-3 py-2.5">
          <Logo locale={locale} brand={t.brand} theme={theme} />
          <Dropdown summaryClass="flex cursor-pointer list-none items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-brand-50"
            summary={<><Icon d={MENU} /><span className="hidden sm:inline">{L.extra.categories}</span></>}>
            <nav className="absolute start-0 z-40 mt-2 flex w-64 flex-col rounded-2xl border border-line bg-white p-2 text-sm shadow-lg">{links}</nav>
          </Dropdown>
          <div className="hidden min-w-0 flex-1 md:block">{search}</div>
          <div className="ms-auto">{actions}</div>
          <div className="hidden xl:block">{lang}</div>
        </div>
      ) : H.style === "centered" ? (
        <div className="wrap grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3">
          <div className="hidden min-w-0 md:block">{search}</div>
          <div className="col-start-2 justify-self-center"><Logo locale={locale} brand={t.brand} theme={theme} /></div>
          <div className="justify-self-end">{actions}</div>
        </div>
      ) : (
        <div className="wrap flex items-center gap-3 py-2.5">
          <Logo locale={locale} brand={t.brand} theme={theme} />
          <div className="hidden min-w-0 flex-1 md:block">{search}</div>
          <div className="ms-auto">{actions}</div>
        </div>
      )}

      <div className="wrap pb-2 md:hidden">{search}</div>

      {H.style !== "compact" && (
        <div className={stacked ? "bg-brand-600 text-white" : "border-t border-line/70"}>
          <div className={`wrap flex items-center gap-2 ${H.style === "centered" ? "justify-center" : ""}`}>
            <nav aria-label={L.menu} className={`no-scrollbar -mx-1 flex min-w-0 items-center overflow-x-auto py-1 text-sm ${H.style === "centered" ? "" : "flex-1"}`}>
              {links}
            </nav>
            {lang && <div className={`hidden shrink-0 sm:block ${stacked ? "[&_a]:text-white" : ""}`}>{lang}</div>}
          </div>
        </div>
      )}
    </header>
  );
}

function Footer({ locale, theme }: { locale: Locale; theme: Theme }) {
  const t = getDictionary(locale);
  const L = getLookTexts(locale);
  const F = L.footer;
  const C = theme.footer;
  const a = "hover:text-brand-700 hover:underline";
  const about = tr(C.about, locale) || F.about;
  const socials = Object.entries(C.social).filter(([, v]) => v);
  const contact = (C.phone || C.email || tr(C.address, locale) || tr(C.hours, locale)) && (
    <div>
      <h2 className="mb-2 font-bold text-accent-600">{L.extra.contact}</h2>
      <ul className="space-y-1.5 text-muted">
        {C.phone && <li><a href={`tel:${C.phone.replace(/[^\d+]/g, "")}`} className={a} dir="ltr">{C.phone}</a></li>}
        {C.email && <li><a href={`mailto:${C.email}`} className={a} dir="ltr">{C.email}</a></li>}
        {tr(C.address, locale) && <li>{tr(C.address, locale)}</li>}
        {tr(C.hours, locale) && <li>{tr(C.hours, locale)}</li>}
      </ul>
    </div>
  );
  const social = socials.length > 0 && (
    <div className="flex flex-wrap gap-2 text-sm">
      {socials.map(([k, v]) => (
        <a key={k} href={v} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1 hover:border-brand-500 hover:text-brand-700">
          {L.extra.socials[k] ?? k}
        </a>
      ))}
    </div>
  );
  const lang = <Suspense fallback={null}><LanguageSwitcher current={locale} label={t.nav.language} /></Suspense>;

  if (C.style === "minimal") {
    return (
      <footer className="mt-12 border-t border-line bg-white">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-muted">
          <span>© {t.brand} — {L.extra.rights}</span>
          {social}
          <span>{F.test}</span>
        </div>
      </footer>
    );
  }
  if (C.style === "simple") {
    return (
      <footer className="mt-12 border-t border-line bg-white">
        <div className="wrap flex flex-wrap items-center justify-between gap-4 py-6 text-sm">
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-muted">
            <Link className={a} href={`/${locale}/products?col=all`}>{L.allProducts}</Link>
            <Link className={a} href={`/${locale}/finder`}>{L.finder}</Link>
            <Link className={a} href={`/${locale}/pharmacies`}>{L.pharmacies}</Link>
            <Link className={a} href={`/${locale}/pharmacy/register`}>{F.registerPharmacy}</Link>
            {C.phone && <a className={a} href={`tel:${C.phone.replace(/[^\d+]/g, "")}`} dir="ltr">{C.phone}</a>}
          </nav>
          {social}
          <div className="sm:hidden">{lang}</div>
        </div>
        <p className="wrap border-t border-line py-3 text-xs text-muted">{F.test}</p>
      </footer>
    );
  }
  return (
    <footer className="mt-12 bg-white">
      {C.features && (
        <div className="bg-gradient-to-l from-brand-400 to-brand-600 text-white">
          <div className="wrap flex flex-wrap items-center justify-between gap-3 py-5">
            <span className="text-2xl font-extrabold">{tr(theme.logo.text, locale) || t.brand}</span>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {([["near", "/about#nearest"], ["pharmacist", "/about#pharmacist"], ["finder", "/finder"], ["escrow", "/about#escrow"]] as const).map(([k, href]) => (
                <li key={k}><Link href={`/${locale}${href}`} className="hover:underline">{L.features[k]}</Link></li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="wrap grid gap-8 py-8 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <h2 className="mb-2 font-bold text-accent-600">{F.aboutTitle}</h2>
          <p className="max-w-xl whitespace-pre-line leading-7 text-muted">{about}</p>
          {social && <div className="mt-4"><p className="mb-2 font-semibold">{L.extra.follow}</p>{social}</div>}
        </div>
        <div>
          <h2 className="mb-2 font-bold text-accent-600">{F.links}</h2>
          <ul className="space-y-1.5 text-muted">
            <li><Link className={a} href={`/${locale}/products?col=all`}>{L.allProducts}</Link></li>
            <li><Link className={a} href={`/${locale}/finder`}>{L.finder}</Link></li>
            <li><Link className={a} href={`/${locale}/pharmacies`}>{L.pharmacies}</Link></li>
            <li><Link className={a} href={`/${locale}/account/orders`}>{L.myOrders}</Link></li>
          </ul>
        </div>
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 font-bold text-accent-600">{F.pharmaciesTitle}</h2>
            <ul className="space-y-1.5 text-muted">
              <li><Link className={a} href={`/${locale}/pharmacy/register`}>{F.registerPharmacy}</Link></li>
              <li><Link className={a} href={`/${locale}/login?next=/${locale}/pharmacy/dashboard`}>{F.pharmacyLogin}</Link></li>
            </ul>
          </div>
          {contact}
          <div className="sm:hidden">{lang}</div>
        </div>
      </div>
      <p className="wrap border-t border-line py-4 text-xs text-muted">{F.test}</p>
    </footer>
  );
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await resolveLocale(params);
  const theme = await loadTheme();
  const L = getLookTexts(locale);
  const R4 = getRound4Texts(locale);
  const nav = theme.app.bottomNav as "off" | "mobile" | "app";
  const divider = theme.footer.divider !== "none" && theme.footer.style !== "minimal" ? theme.footer.divider as "wave" | "curve" | "bump" | "zigzag" | "tilt" : null;
  const banded = theme.footer.style === "full" && theme.footer.features;
  const inCart = cartCount(await readCart());
  return (
    <html lang={locale} dir={LOCALES[locale].dir} className={FONT_VARS} {...themeAttrs(theme)} data-bottomnav={nav === "off" ? undefined : nav}>
      <head>
        <style id="theme-vars" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      </head>
      <body id="top" className="flex min-h-screen flex-col antialiased">
        {theme.preview && (
          <div id="theme-preview-bar" className="flex flex-wrap items-center justify-center gap-3 bg-amber-300 px-4 py-1.5 text-sm text-amber-950">
            <span>{L.extra.previewing(theme.preview.name)}</span>
            <form action={stopThemePreview}>
              <input type="hidden" name="back" value={`/${locale}`} />
              <button className="rounded-full bg-amber-950 px-3 py-0.5 text-xs font-bold text-amber-50">{L.extra.exitPreview}</button>
            </form>
            <ThemePreviewListener />
          </div>
        )}
        <Header locale={locale} theme={theme} />
        <main className="wrap flex-1 py-6">{children}</main>
        <div className={`relative ${divider ? "mt-20 [&>footer]:mt-0" : ""}`}>
          {divider && (
            <Shape kind={divider} className={`absolute bottom-full left-0 h-10 w-full sm:h-14 ${banded ? "" : "text-white"}`}
              gradient={banded ? ["var(--color-brand-400)", "var(--color-brand-600)"] : undefined} />
          )}
          {divider === "bump" && (
            <a href="#top" aria-label={R4.toTop} title={R4.toTop}
              className={`absolute bottom-full left-1/2 mb-1 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full sm:mb-3 ${banded ? "text-white hover:bg-white/15" : "text-brand-700 hover:bg-brand-50"}`}>
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M6 14l6-6 6 6" /></svg>
            </a>
          )}
          <Footer locale={locale} theme={theme} />
        </div>
        <FormMessages m={R4.form} />
        <SiteTools style={theme.extras.toTop} side={theme.extras.toTopSide} toBottom={theme.extras.toBottom} progress={theme.extras.progress}
          raised={nav !== "off"} labels={{ top: R4.toTop, bottom: R4.toBottom }} />
        {nav !== "off" && (
          <BottomNav onlyApp={nav === "app"} label={L.menu} items={[
            { key: "home", href: `/${locale}`, label: R4.nav.home, icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
            { key: "products", href: `/${locale}/products`, label: R4.nav.products, icon: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z" },
            { key: "finder", href: `/${locale}/finder`, label: R4.nav.finder, icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4M11 8v6M8 11h6" },
            { key: "cart", href: `/${locale}/cart`, label: R4.nav.cart, icon: "M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
              badge: inCart > 0 ? formatNumber(inCart, locale) : undefined },
            { key: "account", href: `/${locale}/account`, label: R4.nav.account, icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" },
          ]} />
        )}
        <AppSupport install={theme.app.install} raised={nav === "mobile"} texts={R4.install} />
      </body>
    </html>
  );
}
