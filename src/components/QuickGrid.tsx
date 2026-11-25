import Link from "next/link";
import { Icon } from "@/components/Icons";
import type { Locale } from "@/i18n";
import { getRound4Texts } from "@/i18n/dictionaries/round4";

const TILES = [
  { key: "products", href: "/products?col=all", icon: "store", tone: "bg-brand-50 text-brand-700" },
  { key: "finder", href: "/finder", icon: "search", tone: "bg-accent-50 text-accent-700" },
  { key: "pharmacies", href: "/pharmacies", icon: "map", tone: "bg-emerald-50 text-emerald-700" },
  { key: "orders", href: "/account/orders", icon: "truck", tone: "bg-sky-50 text-sky-700" },
  { key: "cart", href: "/cart", icon: "bottle", tone: "bg-amber-50 text-amber-700" },
  { key: "near", href: "/pharmacies#near", icon: "pharmacist", tone: "bg-rose-50 text-rose-700" },
  { key: "rx", href: "/about#rx", icon: "rx", tone: "bg-slate-100 text-slate-700", soon: true },
  { key: "advice", href: "/about#advice", icon: "chat", tone: "bg-slate-100 text-slate-700", soon: true },
] as const;

// App-style start screen for phones: greeting, a big search box and shortcut tiles.
// Shown on all phones or only inside the installed app (theme studio › tools).
export function QuickGrid({ locale, mode }: { locale: Locale; mode: string }) {
  if (mode === "off") return null;
  const T = getRound4Texts(locale).quick;
  return (
    <section className={`${mode === "app" ? "app-only" : ""} md:hidden`}>
      <div className="space-y-4 rounded-3xl bg-gradient-to-l from-brand-700 to-brand-400 p-4 text-white">
        <p className="text-lg font-extrabold">{T.hello}</p>
        <form action={`/${locale}/products`} role="search">
          <input type="search" name="q" placeholder={T.search} aria-label={T.search}
            className="w-full rounded-2xl border-0 bg-white px-4 py-3 text-ink shadow focus:outline-none focus:ring-2 focus:ring-accent-600" />
        </form>
        <ul className="grid grid-cols-4 gap-2">
          {TILES.map((t) => (
            <li key={t.key}>
              <Link href={`/${locale}${t.href}`} className="relative flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2 text-center text-ink shadow-sm active:scale-95">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${t.tone}`}><Icon name={t.icon} className="h-6 w-6" /></span>
                <span className="line-clamp-2 text-[11px] font-semibold leading-4">{T.tiles[t.key]}</span>
                {"soon" in t && <span className="absolute -top-1.5 end-0 rounded-full bg-accent-600 px-1.5 text-[9px] leading-4 text-white">{T.soon}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
