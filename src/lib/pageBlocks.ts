import { SUPABASE_URL } from "@/lib/config";

// Page builder blocks. The database validates every block again on save
// (allowed types, counts, images in the page's own folder, internal links,
// no prescription products), so these types are a convenience, not a guard.

export type I18nText = { fa?: string; en?: string; ar?: string };
export type LinkKind = "none" | "collection" | "product" | "search" | "path";
export type PageLink = { kind: LinkKind; value?: string };

/** A slide is an uploaded picture, or a designed text slide (title on a colored background). */
export type BannerSlide = {
  image?: string; alt?: I18nText; link?: PageLink;
  title?: I18nText; subtitle?: I18nText; cta?: I18nText; tone?: string;
};

/** Options every block has: where it shows, and the band and edge shape around it. */
export type Device = "mobile" | "tablet" | "desktop";
export type BlockLook = {
  devices?: Device[];
  band?: "none" | "soft" | "brand" | "accent" | "dark" | "gradient";
  divider?: "none" | "wave" | "curve" | "zigzag" | "tilt" | "bump";
};
export const DEVICES: Device[] = ["mobile", "tablet", "desktop"];
export const BANDS = ["none", "soft", "brand", "accent", "dark", "gradient"] as const;
export const DIVIDERS = ["none", "wave", "curve", "zigzag", "tilt", "bump"] as const;

export type BannerBlock = BlockLook & {
  id: string; type: "banner"; height?: "xs" | "s" | "m" | "l" | "xl";
  shape?: "rounded" | "soft" | "square" | "pill" | "arch" | "tilt" | "wave";
  display?: "slider" | "peek" | "grid" | "bento" | "stack";
  slides: BannerSlide[];
};
export type ProductSource = {
  source: "collection" | "bestselling" | "discount" | "newest" | "manual";
  collection?: string; products?: string[];
};
export type ProductsBlock = BlockLook & ProductSource & {
  id: string; type: "products"; title?: I18nText; limit?: number;
  display?: "row" | "grid" | "list" | "bento";
};
export type Tab = ProductSource & { title: I18nText };
/** Several product lists under one heading; the visitor switches between them. */
export type TabsBlock = BlockLook & {
  id: string; type: "tabs"; title?: I18nText; tabs: Tab[]; limit?: number;
  display?: "row" | "grid"; look?: "pills" | "underline" | "boxed";
};
export type TileItem = { label: I18nText; image?: string; icon?: string; tone?: string; link?: PageLink };
export type CategoriesBlock = BlockLook & {
  id: string; type: "categories"; title?: I18nText; items: TileItem[];
  display?: "row" | "grid" | "circles" | "cards" | "chips" | "masonry" | "bento"; size?: "s" | "m" | "l";
};
/** Row of icons with short labels ("why Dorva"). */
export type FeaturesBlock = BlockLook & {
  id: string; type: "features"; title?: I18nText; items: TileItem[];
  display?: "strip" | "cards" | "icons" | "list"; size?: "s" | "m" | "l";
};
export type TextBlock = BlockLook & {
  id: string; type: "text"; style?: "plain" | "info" | "notice" | "quote" | "highlight"; title?: I18nText; body?: I18nText;
};

export type Block = BannerBlock | ProductsBlock | TabsBlock | CategoriesBlock | TextBlock | FeaturesBlock;
export const BLOCK_TYPES = ["banner", "features", "categories", "products", "tabs", "text"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Display options per block type, in the order the editor shows them. */
export const DISPLAYS: Partial<Record<BlockType, readonly string[]>> = {
  banner: ["slider", "peek", "grid", "bento", "stack"],
  products: ["row", "grid", "list", "bento"],
  tabs: ["row", "grid"],
  categories: ["row", "grid", "circles", "cards", "chips", "masonry", "bento"],
  features: ["strip", "cards", "icons", "list"],
};

export const MEDIA_BUCKET = "page-media";
export const mediaUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;

export const newId = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "x").padEnd(8, "0");

export function emptyBlock(type: BlockType): Block {
  const id = newId();
  if (type === "banner") return { id, type, height: "m", slides: [] };
  if (type === "products") return { id, type, source: "bestselling", limit: 12, title: { fa: "" } };
  if (type === "tabs") return { id, type, title: { fa: "" }, limit: 12, tabs: [
    { title: { fa: "پرفروش‌ها", en: "Best sellers", ar: "الأكثر مبيعاً" }, source: "bestselling" },
    { title: { fa: "تخفیف‌دارها", en: "On sale", ar: "تخفيضات" }, source: "discount" },
  ] };
  if (type === "categories") return { id, type, title: { fa: "" }, items: [] };
  if (type === "features") return { id, type, items: [] };
  return { id, type, style: "info", title: { fa: "" }, body: { fa: "" } };
}

/** Text in the visitor's language, falling back to Persian. */
export const tr = (t: I18nText | undefined, locale: string) =>
  (t?.[locale as keyof I18nText] || t?.fa || "").trim();

/** Where a link goes; the pharmacy's own page for searches and collections on a pharmacy page. */
export function linkHref(link: PageLink | undefined, locale: string, base: string): string | null {
  if (!link || link.kind === "none" || !link.value) return null;
  const v = link.value;
  const join = (q: string) => `${base}${base.includes("?") ? "&" : "?"}${q}`;
  switch (link.kind) {
    case "collection": return join(`col=${encodeURIComponent(v)}`);
    case "search": return join(`q=${encodeURIComponent(v)}`);
    case "product": return `/${locale}/product/${v}`;
    case "path": return v.startsWith("/") && !v.startsWith("//") ? `/${locale}${v === "/" ? "" : v}` : null;
  }
  return null;
}

export function asBlocks(v: unknown): Block[] {
  return Array.isArray(v) ? (v.filter((b) => b && typeof b === "object" && (BLOCK_TYPES as readonly string[]).includes((b as Block).type)) as Block[]) : [];
}
