import Link from "next/link";
import { addToCart } from "@/app/[locale]/cart/actions";
import { ProductImage } from "@/components/ProductImage";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney, formatNumber, localized, type Locale } from "@/i18n";
import type { ThemeConfig } from "@/lib/themeConfig";
import { getCatalogTexts } from "@/i18n/dictionaries/catalog";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { getRules } from "@/i18n/dictionaries/rules";
import { catPath } from "@/lib/catNames";

export type CardItem = {
  product_id: string; name_fa: string; name_i18n: Record<string, string>; dispensing_class: string; category_path: string[];
  image_url: string | null; min_price: number | null; max_price: number | null; max_discount: number | null; pharmacies: number;
};
export type CardTexts = { from: (p: string) => string; inPharmacies: (n: string) => string; off: (n: string) => string;
  notAvailable: string; needsRx: string; add: string; adding: string };

const RATIO = { square: "aspect-square", portrait: "aspect-[3/4]", landscape: "aspect-[4/3]" } as const;
const PRICE = { ink: "", brand: "text-brand-700", accent: "text-accent-600" } as const;

// One product card for every list (products page, rows, pharmacy page), styled
// by the theme: card style, picture shape, title lines, what is shown, quick add.
export async function ProductCard({ item: p, locale, card, href, back, texts, view = "grid", className = "", single = false, children }: {
  item: CardItem; locale: Locale; card: ThemeConfig["card"]; href: string; texts: CardTexts;
  /** page to come back to after a quick add; no quick add when omitted */
  back?: string;
  view?: "grid" | "list";
  className?: string;
  /** a single pharmacy's list: no "in n pharmacies" */
  single?: boolean;
  /** replaces the quick add (e.g. the pharmacy page's quantity + add) */
  children?: React.ReactNode;
}) {
  const name = localized(p.name_fa, p.name_i18n, locale);
  const fmt = (n: number) => formatNumber(n, locale);
  const priced = p.pharmacies > 0 && p.min_price != null;
  const rx = p.dispensing_class === "rx";
  const discount = Number(p.max_discount) > 0;
  const center = card.align === "center" && view === "grid";
  const showAdd = !!back && priced && !rx && card.quickAdd !== "none" && !children;
  const list = view === "list";

  const quick = showAdd && (
    <form action={addToCart} className={list ? "" : "mt-2"}>
      <input type="hidden" name="product_id" value={p.product_id} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="qty" value="1" />
      {card.quickAdd === "icon" && !list
        ? <SubmitButton className="btn absolute end-3 top-3 h-10 w-10 rounded-full p-0 text-lg shadow" ariaLabel={texts.add} pendingLabel="…">+</SubmitButton>
        : <SubmitButton className={`btn ${list ? "" : "w-full"} py-1.5 text-xs`} pendingLabel={texts.adding}>{texts.add}</SubmitButton>}
    </form>
  );

  return (
    <div id={`p-${p.product_id}`} data-style={card.style}
      className={`pcard ${list ? "flex-row items-center gap-3" : ""} ${center ? "text-center" : ""} ${className}`}>
      <Link href={href} className={`${list ? "flex min-w-0 flex-1 items-center gap-3" : "block flex-1 space-y-1"}`}>
        <span className={`relative block shrink-0 overflow-hidden rounded-xl ${list ? "w-20 sm:w-24" : "mb-2 w-full"} ${RATIO[card.image as keyof typeof RATIO] ?? RATIO.square}`}>
          <ProductImage id={p.product_id} name={name} section={p.category_path[0]} imageUrl={p.image_url} fill />
          {card.discount && discount && (
            <span className="absolute start-2 top-2 rounded-full bg-sale px-2 py-0.5 text-[11px] font-bold text-white">
              {texts.off(fmt(Number(p.max_discount)))}
            </span>
          )}
        </span>
        <span className="block min-w-0 space-y-1">
          <span className="line-clamp-1-3 block text-sm font-semibold leading-6 sm:text-[0.95rem]" style={{ "--title-lines": card.titleLines } as React.CSSProperties}>{name}</span>
          {card.category && p.category_path.length > 0 && <span className="block truncate text-xs text-muted">{await catPath(p.category_path, locale)}</span>}
          {priced ? (
            <>
              <span className={`block pt-1 font-bold ${PRICE[card.price as keyof typeof PRICE] ?? ""}`}>
                {Number(p.min_price) === Number(p.max_price) ? formatMoney(p.min_price, locale) : texts.from(formatMoney(p.min_price, locale))}
              </span>
              {card.pharmacies && !single && <span className="block text-xs text-muted">{texts.inPharmacies(fmt(p.pharmacies))}</span>}
            </>
          ) : <span className="block pt-1 text-xs text-muted">{texts.notAvailable}</span>}
          {rx && <span className="chip">{texts.needsRx}</span>}
        </span>
      </Link>
      {children}
      {quick}
    </div>
  );
}

export function cardTexts(locale: Locale): CardTexts {
  const c = getCatalogTexts(locale), r = getRules(locale);
  return { from: c.from, inPharmacies: c.inPharmacies, off: r.discountOff, notAvailable: c.notAvailable, needsRx: c.needsRx,
    add: getCollectionTexts(locale).quickAdd, adding: r.adding };
}
