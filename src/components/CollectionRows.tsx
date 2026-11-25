import Link from "next/link";
import { cardTexts, ProductCard } from "@/components/ProductCard";
import { Scroller } from "@/components/Scroller";
import { formatNumber, type Locale } from "@/i18n";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { titleOf, type FeaturedGroup } from "@/lib/collections";
import { loadTheme } from "@/lib/theme";

const GRID = {
  grid: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5",
  list: "grid gap-3 md:grid-cols-2",
  bento: "grid grid-flow-dense grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5",
} as const;
const WIDTH = { s: "w-[40%] sm:w-40 lg:w-44", m: "w-[44%] sm:w-48 lg:w-52", l: "w-[70%] sm:w-60 lg:w-64" } as const;

// Horizontal product rows (one per featured collection) with an "All (n)" link.
export async function CollectionRows({ groups, locale, seeAllBase, productQuery = "", back, showAll = true, display = "row", hideTitle = false }: {
  groups: FeaturedGroup[];
  locale: Locale;
  /** page that lists a whole collection; ?col=<slug> is appended */
  seeAllBase: string;
  /** extra query for product links, e.g. "?city=tehran" */
  productQuery?: string;
  /** page to return to after a quick add; no quick-add button when omitted */
  back?: string;
  /** "All (n)" link to the collection page; off for rows that are not collections */
  showAll?: boolean;
  /** row: one swipeable row; grid; list; bento: the first product large */
  display?: "row" | "grid" | "list" | "bento";
  /** no heading (inside product tabs) */
  hideTitle?: boolean;
}) {
  if (groups.length === 0) return null;
  const c = getCollectionTexts(locale);
  const theme = await loadTheme();
  const texts = cardTexts(locale);
  const width = WIDTH[theme.rows.size as keyof typeof WIDTH] ?? WIDTH.m;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={hideTitle ? undefined : `row-${g.id}`}>
          {(!hideTitle || showAll) && (
            <div className="mb-2 flex items-baseline justify-between gap-3">
              {hideTitle ? <span /> : <h2 id={`row-${g.id}`} className="section-title">{titleOf(g.title, locale)}</h2>}
              {showAll && (
                <Link href={`${seeAllBase}${seeAllBase.includes("?") ? "&" : "?"}col=${g.slug}`}
                  className="text-sm font-medium text-brand-700 hover:underline">{c.seeAll(formatNumber(g.total, locale))}</Link>
              )}
            </div>
          )}
          {display === "row" ? (
            <Scroller label={titleOf(g.title, locale)} arrows={theme.rows.arrows}>
              {g.items.map((p) => (
                <li key={p.product_id} className={`flex shrink-0 snap-start ${width}`}>
                  <ProductCard item={p} locale={locale} card={theme.card} href={`/${locale}/product/${p.product_id}${productQuery}`}
                    back={back} texts={texts} className="w-full" />
                </li>
              ))}
            </Scroller>
          ) : (
            <ul className={GRID[display]}>
              {g.items.map((p, i) => (
                <li key={p.product_id} className={`flex ${display === "bento" && i === 0 ? "col-span-2 row-span-2" : ""}`}>
                  <ProductCard item={p} locale={locale} card={theme.card} href={`/${locale}/product/${p.product_id}${productQuery}`}
                    back={back} texts={texts} className="w-full" view={display === "list" ? "list" : "grid"} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
