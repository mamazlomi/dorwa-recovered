import Link from "next/link";
import { BannerCarousel } from "@/components/BannerCarousel";
import { CollectionRows } from "@/components/CollectionRows";
import { Icon, TONES } from "@/components/Icons";
import { Shape } from "@/components/Shapes";
import { TabSwitch } from "@/components/TabSwitch";
import type { Locale } from "@/i18n";
import type { FeaturedGroup, FeaturedItem } from "@/lib/collections";
import {
  linkHref, mediaUrl, tr,
  type BannerBlock, type Block, type BannerSlide, type BlockLook, type CategoriesBlock, type FeaturesBlock, type ProductSource, type TileItem,
} from "@/lib/pageBlocks";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------- shared look
const HEIGHT = { xs: "h-28 sm:h-32", s: "h-36 sm:h-44", m: "h-48 sm:h-64", l: "h-56 sm:h-80", xl: "h-64 sm:h-[26rem]" } as const;
const SHAPE = {
  rounded: "rounded-3xl", soft: "rounded-xl", square: "rounded-none", pill: "rounded-[3rem]",
  arch: "rounded-t-[7rem] rounded-b-3xl sm:rounded-t-[12rem]", tilt: "shape-tilt", wave: "shape-wave",
} as const;
const TEXT_STYLE = {
  plain: "card",
  info: "rounded-2xl border border-brand-100 bg-brand-50 p-5",
  notice: "rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950",
  quote: "border-s-4 border-accent-600 ps-5 py-2 text-lg",
  highlight: "rounded-3xl bg-gradient-to-l from-brand-700 to-brand-400 p-6 text-center text-white sm:p-10",
} as const;
// which screens a block shows on: phones < 640px, tablets 640–1023px, computers ≥ 1024px
const SHOW: Record<string, string> = {
  "mobile": "sm:hidden", "tablet": "hidden sm:block lg:hidden", "desktop": "hidden lg:block",
  "mobile,tablet": "lg:hidden", "desktop,tablet": "hidden sm:block", "desktop,mobile": "sm:hidden lg:block",
};
const BAND = {
  soft: "bg-brand-50 text-brand-50", brand: "bg-brand-600 text-brand-600", accent: "bg-accent-600 text-accent-600",
  dark: "bg-slate-900 text-slate-900", gradient: "bg-gradient-to-l from-brand-400 to-brand-600 text-brand-500",
} as const;
const GRAD: [string, string] = ["var(--color-brand-400)", "var(--color-brand-600)"];
const ON_BAND = { soft: "", brand: "on-band", accent: "on-band", dark: "on-band", gradient: "on-band" } as const;

/** Visibility per device, then a full-width colored band with shaped edges around the block. */
function Shell({ b, children }: { b: BlockLook & { id: string }; children: React.ReactNode }) {
  const devices = [...new Set(b.devices ?? [])].sort().join(",");
  const show = devices && devices !== "desktop,mobile,tablet" ? SHOW[devices] ?? "" : "";
  const band = b.band && b.band !== "none" ? b.band : b.divider && b.divider !== "none" ? "soft" : null;
  if (!band) return show ? <div className={show}>{children}</div> : <>{children}</>;
  const divider = b.divider && b.divider !== "none" ? b.divider : null;
  return (
    <div className={`${show} relative ${divider ? "my-14 sm:my-16" : ""} ${ON_BAND[band]}`}>
      <div aria-hidden className={`absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 ${BAND[band]}`}>
        {divider && <Shape kind={divider} gradient={band === "gradient" ? GRAD : undefined} className="absolute bottom-full left-0 h-8 w-full sm:h-12" />}
        {divider && <Shape kind={divider} flip gradient={band === "gradient" ? GRAD : undefined} className="absolute left-0 top-full h-8 w-full sm:h-12" />}
      </div>
      <div className="relative py-8">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- banner
function Slide({ s, locale, base, size, shape, eager }: { s: BannerSlide; locale: Locale; base: string; size: string; shape: string; eager: boolean }) {
  const href = linkHref(s.link, locale, base);
  if (s.image) {
    // eslint-disable-next-line @next/next/no-img-element
    const img = <img src={mediaUrl(s.image)} alt={tr(s.alt, locale) || tr(s.title, locale)} loading={eager ? "eager" : "lazy"}
      className={`w-full object-cover ${shape} ${size}`} />;
    return href ? <Link href={href} className="block h-full">{img}</Link> : img;
  }
  // designed slide: no picture needed
  const tone = TONES[s.tone ?? "brand"] ?? TONES.brand;
  const body = (
    <div className={`relative flex ${size} w-full items-center overflow-hidden ${shape} bg-gradient-to-l ${tone.slide} px-6 text-white sm:px-12`}>
      <svg aria-hidden viewBox="0 0 400 400" className="absolute -end-16 -top-16 h-80 w-80 opacity-20 sm:h-[26rem] sm:w-[26rem]">
        <circle cx="200" cy="200" r="150" fill="none" stroke="white" strokeWidth="40" />
        <circle cx="200" cy="200" r="70" fill="white" />
      </svg>
      <svg aria-hidden viewBox="0 0 100 100" className="absolute bottom-6 end-1/3 hidden h-16 w-16 opacity-25 sm:block">
        <path d="M50 10v80M10 50h80" stroke="white" strokeWidth="18" strokeLinecap="round" />
      </svg>
      <div className="relative max-w-xl space-y-3">
        <h2 className="text-2xl font-extrabold leading-tight sm:text-4xl">{tr(s.title, locale)}</h2>
        {tr(s.subtitle, locale) && <p className="text-sm leading-7 text-white/90 sm:text-base">{tr(s.subtitle, locale)}</p>}
        {href && tr(s.cta, locale) && (
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-ink shadow">
            {tr(s.cta, locale)} <span aria-hidden className="rtl:rotate-180">›</span>
          </span>
        )}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

function Banner({ b, locale, base, first }: { b: BannerBlock; locale: Locale; base: string; first: boolean }) {
  const shape = SHAPE[b.shape ?? "rounded"] ?? SHAPE.rounded;
  const h = HEIGHT[b.height ?? "m"] ?? HEIGHT.m;
  const mode = b.display ?? "slider";
  const slide = (s: BannerSlide, n: number, size: string = h) =>
    <Slide key={n} s={s} locale={locale} base={base} size={size} shape={shape} eager={first && n === 0} />;
  if (mode === "grid" || (mode === "bento" && b.slides.length < 3)) {
    return <div className={`grid gap-3 ${b.slides.length > 1 ? "sm:grid-cols-2" : ""} ${b.slides.length > 2 ? "lg:grid-cols-3" : ""}`}>{b.slides.map((s, n) => slide(s, n))}</div>;
  }
  if (mode === "bento") {
    return (
      <div className="grid gap-3 sm:h-[26rem] sm:grid-cols-3 sm:grid-rows-2">
        {b.slides.slice(0, 5).map((s, n) => (
          <div key={n} className={n === 0 ? "sm:col-span-2 sm:row-span-2" : ""}>{slide(s, n, n === 0 ? "h-56 sm:h-full" : "h-36 sm:h-full")}</div>
        ))}
      </div>
    );
  }
  if (mode === "stack") return <div className="space-y-3">{b.slides.map((s, n) => slide(s, n))}</div>;
  return (
    <BannerCarousel peek={mode === "peek"} rounded={shape === SHAPE.rounded}>
      {b.slides.map((s, n) => slide(s, n))}
    </BannerCarousel>
  );
}

// ---------------------------------------------------------------- tiles
const TILE_W = { s: "w-16 sm:w-20", m: "w-24 sm:w-28", l: "w-32 sm:w-36" } as const;

function TileFace({ it, locale, round = false, eager }: { it: TileItem; locale: Locale; round?: boolean; eager?: boolean }) {
  const tone = TONES[it.tone ?? "brand"] ?? TONES.brand;
  const r = round ? "rounded-full" : "rounded-2xl";
  return it.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaUrl(it.image)} alt="" loading={eager ? "eager" : "lazy"} className={`aspect-square w-full object-cover ${r}`} />
  ) : (
    <span aria-hidden className={`flex aspect-square w-full items-center justify-center ${r} ${tone.tile}`}>
      {it.icon ? <Icon name={it.icon} className="h-1/2 w-1/2" /> : <span className="text-2xl font-extrabold">{tr(it.label, locale).slice(0, 1)}</span>}
    </span>
  );
}

/** A picture (or colored panel) with the label written over its bottom. */
function Overlay({ it, locale, ratio }: { it: TileItem; locale: Locale; ratio: string }) {
  const tone = TONES[it.tone ?? "brand"] ?? TONES.brand;
  return (
    <span className={`relative block overflow-hidden rounded-2xl ${ratio}`}>
      {it.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={mediaUrl(it.image)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105" />
        : <span aria-hidden className={`absolute inset-0 bg-gradient-to-br ${tone.slide}`}>
            {it.icon && <Icon name={it.icon} className="absolute end-3 top-3 h-1/3 w-1/3 text-white/40" />}
          </span>}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-10 text-sm font-bold text-white sm:text-base">
        {tr(it.label, locale)}
      </span>
    </span>
  );
}

const MASONRY = ["aspect-[3/4]", "aspect-square", "aspect-[4/3]", "aspect-[4/5]", "aspect-[5/4]"];

function Categories({ b, locale, base }: { b: CategoriesBlock; locale: Locale; base: string }) {
  const mode = b.display ?? "row";
  const w = TILE_W[b.size ?? "m"] ?? TILE_W.m;
  const wrap = (it: TileItem, n: number, cls: string, body: React.ReactNode) => {
    const href = linkHref(it.link, locale, base);
    return href ? <Link key={n} href={href} className={`group ${cls}`}>{body}</Link> : <div key={n} className={cls}>{body}</div>;
  };
  const label = (it: TileItem) => <span className="band-text mt-2 line-clamp-2 text-center text-sm font-semibold">{tr(it.label, locale)}</span>;
  let body: React.ReactNode;
  if (mode === "chips") {
    body = (
      <div className="flex flex-wrap gap-2">
        {b.items.map((it, n) => wrap(it, n, "inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold transition hover:border-brand-500 hover:text-brand-700", (
          <>{it.icon && <Icon name={it.icon} className="h-4 w-4" />}{tr(it.label, locale)}</>
        )))}
      </div>
    );
  } else if (mode === "cards") {
    body = <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{b.items.map((it, n) => wrap(it, n, "block", <Overlay it={it} locale={locale} ratio="aspect-[4/3]" />))}</div>;
  } else if (mode === "masonry") {
    body = <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3 [&>*]:break-inside-avoid">{b.items.map((it, n) => wrap(it, n, "block", <Overlay it={it} locale={locale} ratio={MASONRY[n % MASONRY.length]} />))}</div>;
  } else if (mode === "bento") {
    body = (
      <div className="grid grid-flow-dense auto-rows-[9rem] grid-cols-2 gap-3 sm:auto-rows-[11rem] lg:grid-cols-4">
        {b.items.map((it, n) => wrap(it, n, `block ${n === 0 ? "col-span-2 row-span-2" : n === 3 ? "lg:col-span-2" : ""}`, <Overlay it={it} locale={locale} ratio="h-full" />))}
      </div>
    );
  } else if (mode === "grid") {
    body = <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{b.items.map((it, n) => wrap(it, n, "flex flex-col items-center", <><span className="w-full transition group-hover:-translate-y-0.5"><TileFace it={it} locale={locale} /></span>{label(it)}</>))}</div>;
  } else {
    // row (and circles): one swipeable row on phones; wraps on larger screens
    const round = mode === "circles";
    body = (
      <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:justify-center sm:overflow-visible">
        {b.items.map((it, n) => wrap(it, n, `flex shrink-0 flex-col items-center ${w}`, (
          <><span className="w-full transition group-hover:-translate-y-0.5"><TileFace it={it} locale={locale} round={round} /></span>{label(it)}</>
        )))}
      </div>
    );
  }
  return (
    <section>
      {tr(b.title, locale) && <h2 className="section-title mb-3">{tr(b.title, locale)}</h2>}
      {body}
    </section>
  );
}

const ICON_BOX = { s: "h-9 w-9", m: "h-11 w-11", l: "h-14 w-14" } as const;

function Features({ b, locale, base }: { b: FeaturesBlock; locale: Locale; base: string }) {
  const mode = b.display ?? "strip";
  const box = ICON_BOX[b.size ?? "m"] ?? ICON_BOX.m;
  const item = (it: TileItem, n: number, cls: string, body: React.ReactNode) => {
    const href = linkHref(it.link, locale, base);
    return href ? <Link key={n} href={href} className={`${cls} transition hover:bg-brand-50`}>{body}</Link> : <div key={n} className={cls}>{body}</div>;
  };
  const ico = (it: TileItem, round = false) => (
    <span className={`flex ${box} shrink-0 items-center justify-center ${round ? "rounded-full" : "rounded-2xl"} ${(TONES[it.tone ?? "brand"] ?? TONES.brand).tile}`}>
      <Icon name={it.icon ?? "shield"} className="h-1/2 w-1/2" />
    </span>
  );
  const title = tr(b.title, locale) && <h2 className="section-title mb-3">{tr(b.title, locale)}</h2>;
  if (mode === "cards") {
    return (
      <section>{title}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {b.items.map((it, n) => item(it, n, "card flex flex-col items-center gap-3 p-4 text-center", <>{ico(it, true)}<span className="text-sm font-semibold leading-6">{tr(it.label, locale)}</span></>))}
        </div>
      </section>
    );
  }
  if (mode === "icons") {
    return (
      <section>{title}
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-5">
          {b.items.map((it, n) => item(it, n, "flex w-28 flex-col items-center gap-2 rounded-2xl p-2 text-center", <>{ico(it, true)}<span className="band-text text-sm font-semibold leading-6">{tr(it.label, locale)}</span></>))}
        </div>
      </section>
    );
  }
  if (mode === "list") {
    return (
      <section>{title}
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {b.items.map((it, n) => <li key={n}>{item(it, n, "flex items-center gap-3 rounded-xl p-2", <>{ico(it)}<span className="band-text font-semibold">{tr(it.label, locale)}</span></>)}</li>)}
        </ul>
      </section>
    );
  }
  return (
    <section aria-label={tr(b.title, locale) || undefined}
      className="grid grid-cols-2 gap-2 rounded-3xl border border-line bg-white p-3 sm:grid-cols-3 lg:grid-cols-6">
      {b.items.map((it, n) => item(it, n, "flex items-center gap-3 rounded-2xl p-2", <>{ico(it)}<span className="text-sm font-semibold leading-6">{tr(it.label, locale)}</span></>))}
    </section>
  );
}

// ---------------------------------------------------------------- page
// Renders a page built in the page builder. Product rows are loaded here, on
// the server, and never contain prescription items (page_products filters them).
export async function PageBlocks({ blocks, locale, supabase, pharmacyId, cityId, base, back, productQuery = "" }: {
  blocks: Block[];
  locale: Locale;
  supabase: Client;
  pharmacyId: string | null;
  cityId: number | null;
  /** page that searches and collections open on */
  base: string;
  back?: string;
  productQuery?: string;
}) {
  const load = async (key: string, src: ProductSource, limit: number, title: Record<string, string> | undefined) => {
    const [{ data }, col] = await Promise.all([
      supabase.rpc("page_products", {
        p_source: src.source, p_collection: src.source === "collection" ? src.collection ?? null : null,
        p_ids: src.source === "manual" ? src.products ?? [] : null, p_pharmacy: pharmacyId, p_city: cityId, p_limit: limit,
      }),
      src.source === "collection" && src.collection
        ? supabase.from("collections").select("slug, title").eq("id", src.collection).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const items = (data as FeaturedItem[] | null) ?? [];
    const c = col.data as { slug: string; title: Record<string, string> } | null;
    const t = title && tr(title, locale) ? title : c?.title ?? {};
    const g: FeaturedGroup = { id: key, slug: c?.slug ?? "", title: t, total: items[0]?.total ?? items.length, items };
    return { g, showAll: !!c };
  };
  const rows = await Promise.all(blocks.map(async (b) => {
    if (b.type === "products") return [await load(b.id, b, b.limit ?? 12, b.title as Record<string, string>)];
    if (b.type === "tabs") return Promise.all(b.tabs.map((t, n) => load(`${b.id}-${n}`, t, b.limit ?? 12, t.title as Record<string, string>)));
    return null;
  }));

  return (
    <div className="space-y-8">
      {blocks.map((b, i) => {
        let body: React.ReactNode = null;
        if (b.type === "banner") {
          if (b.slides.length) body = <Banner b={b} locale={locale} base={base} first={i === 0} />;
        } else if (b.type === "products") {
          const r = rows[i]?.[0];
          if (r && r.g.items.length) {
            body = <CollectionRows groups={[r.g]} locale={locale} seeAllBase={base} showAll={r.showAll}
              productQuery={productQuery} back={back} display={b.display ?? "row"} />;
          }
        } else if (b.type === "tabs") {
          const tabs = (rows[i] ?? []).map((r, n) => ({ r, title: tr(b.tabs[n]?.title, locale) })).filter((x) => x.r.g.items.length > 0);
          if (tabs.length) {
            body = (
              <section>
                {tr(b.title, locale) && <h2 className="section-title mb-3">{tr(b.title, locale)}</h2>}
                <TabSwitch titles={tabs.map((x) => x.title)} look={b.look ?? "pills"}>
                  {tabs.map((x) => (
                    <CollectionRows key={x.r.g.id} groups={[x.r.g]} locale={locale} seeAllBase={base} showAll={x.r.showAll}
                      productQuery={productQuery} back={back} display={b.display ?? "row"} hideTitle />
                  ))}
                </TabSwitch>
              </section>
            );
          }
        } else if (b.type === "features") {
          if (b.items.length) body = <Features b={b} locale={locale} base={base} />;
        } else if (b.type === "categories") {
          if (b.items.length) body = <Categories b={b} locale={locale} base={base} />;
        } else if (b.type === "text") {
          const title = tr(b.title, locale), text = tr(b.body, locale);
          if (title || text) {
            body = (
              <section className={TEXT_STYLE[b.style ?? "plain"] ?? TEXT_STYLE.plain}>
                {title && <h2 className={`mb-1 font-bold ${b.style === "highlight" ? "text-2xl sm:text-3xl" : "text-lg"}`}>{title}</h2>}
                {text && <p className={`whitespace-pre-line leading-7 ${b.style === "highlight" ? "mx-auto max-w-2xl text-white/90" : ""}`}>{text}</p>}
              </section>
            );
          }
        }
        return body ? <Shell key={b.id} b={b}>{body}</Shell> : null;
      })}
    </div>
  );
}
