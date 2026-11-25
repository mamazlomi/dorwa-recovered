import SPEC from "./themeSpec.json";

// The storefront look ("theme"). Stored per theme as a partial object; anything
// missing falls back to DEFAULTS. Every key and allowed value is listed in
// themeSpec.json, which the database uses too (app.theme_validate).

export type I18n = { fa?: string; en?: string; ar?: string };
export type Rule =
  | { t: "color" } | { t: "bool" } | { t: "enum"; v: string[] } | { t: "num"; min: number; max: number }
  | { t: "text"; max: number } | { t: "i18n"; max: number } | { t: "path" } | { t: "url" } | { t: "image" };
export const RULES = SPEC as unknown as Record<string, Rule>;

export const DEFAULTS = {
  colors: { primary: "#0e76a8", highlight: "#1fbedb", accent: "#6b3af7", background: "#f5f8fb", surface: "#ffffff",
    text: "#16202a", muted: "#5d6b78", border: "#e2e8ee", sale: "#dc2626" },
  mode: "light" as "light" | "dark",
  font: { body: "vazirmatn", heading: "same", size: 15, headingWeight: "800" },
  shape: { radius: 16, button: "solid", shadow: "none", borders: true },
  layout: { width: 1320, density: "normal", background: "plain" },
  logo: { mode: "image", height: 32, image: "", text: { fa: "دوروا", en: "Dorva", ar: "دوروا" } as I18n },
  header: { style: "classic", sticky: true, deliverTo: true, language: true, categories: true, finder: true,
    announce: { on: false, text: {} as I18n, link: "", tone: "brand" } },
  footer: { style: "full", features: true, about: {} as I18n, phone: "", email: "", address: {} as I18n, hours: {} as I18n,
    social: { instagram: "", telegram: "", whatsapp: "", linkedin: "", aparat: "", eitaa: "" }, divider: "none" },
  card: { style: "classic", image: "square", titleLines: 2, category: true, pharmacies: true, discount: true,
    quickAdd: "full", price: "ink", align: "start" },
  grid: { mobile: 2, desktop: 3, view: "grid", toggle: true, filters: "side" },
  rows: { size: "m", arrows: true },
  product: { layout: "side", offers: "list", specs: "after", stickyBuy: true },
  pharmacy: { hero: "card", list: "grid" },
  cart: { summary: "side" },
  extras: { toTop: "circle", toTopSide: "end", toBottom: false, progress: false },
  app: { bottomNav: "app", quickGrid: "app", install: true },
};
export type ThemeConfig = typeof DEFAULTS;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export function getPath(o: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);
}
export function setPath<T>(o: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const clone = structuredClone(o) as Obj;
  let cur = clone;
  keys.slice(0, -1).forEach((k) => { if (!isObj(cur[k])) cur[k] = {}; cur = cur[k] as Obj; });
  cur[keys[keys.length - 1]] = value;
  return clone as T;
}

/** Is this value allowed for this key? (mirrors app.theme_validate) */
export function valid(path: string, v: unknown): boolean {
  const r = RULES[path];
  if (!r) return false;
  switch (r.t) {
    case "color": return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
    case "bool": return typeof v === "boolean";
    case "enum": return typeof v === "string" && r.v.includes(v);
    case "num": return typeof v === "number" && v >= r.min && v <= r.max;
    case "text": return typeof v === "string" && v.length <= r.max;
    case "i18n": return isObj(v) && Object.entries(v).every(([k, x]) => ["fa", "en", "ar"].includes(k) && typeof x === "string" && x.length <= r.max);
    case "path": return typeof v === "string" && (v === "" || (/^\/[a-z0-9/_?=&%.-]{0,150}$/.test(v) && !v.startsWith("//")));
    case "url": return typeof v === "string" && (v === "" || /^https:\/\/[^\s"'<>]{3,200}$/.test(v));
    case "image": return typeof v === "string" && (v === "" || /^(theme|[0-9a-f-]{36})\/[a-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$/.test(v));
  }
}

/** Defaults overlaid with the stored theme; unknown or invalid values are ignored. */
export function resolveTheme(stored: unknown): ThemeConfig {
  let out: ThemeConfig = structuredClone(DEFAULTS);
  for (const path of Object.keys(RULES)) {
    const v = getPath(stored, path);
    if (v !== undefined && valid(path, v)) out = setPath(out, path, v);
  }
  return out;
}

/** Only what differs from the defaults (what gets saved). */
export function diffTheme(cfg: ThemeConfig): Obj {
  let out: Obj = {};
  for (const path of Object.keys(RULES)) {
    const v = getPath(cfg, path), d = getPath(DEFAULTS, path);
    if (JSON.stringify(v) !== JSON.stringify(d) && valid(path, v)) out = setPath(out, path, v);
  }
  return out;
}

// ---------------------------------------------------------------- CSS
function rgb(h: string): [number, number, number] { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]; }
function mix(h: string, to: string, t: number): string {
  const a = rgb(h), b = rgb(to);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
const W = "#ffffff", K = "#000000";

const DARK = { background: "#0f1720", surface: "#17212c", text: "#e6edf3", muted: "#9aa8b6", border: "#2a3644" };
const SHADOW = {
  none: "none",
  soft: "0 1px 2px rgb(15 23 42 / .06), 0 2px 8px rgb(15 23 42 / .04)",
  medium: "0 2px 6px rgb(15 23 42 / .08), 0 8px 24px rgb(15 23 42 / .06)",
  strong: "0 4px 10px rgb(15 23 42 / .12), 0 16px 40px rgb(15 23 42 / .10)",
} as const;
const DENSITY = { compact: "0.75", normal: "1", spacious: "1.25" } as const;

/** CSS variables for :root; used by the site and by the live editor (instant preview). */
export function themeVars(t: ThemeConfig): Record<string, string> {
  const dark = t.mode === "dark";
  const c = { ...t.colors, ...(dark ? DARK : {}) };
  const base = dark ? c.surface : W;
  return {
    "--color-brand-50": mix(t.colors.primary, base, dark ? 0.82 : 0.93),
    "--color-brand-100": mix(t.colors.primary, base, dark ? 0.7 : 0.84),
    "--color-brand-200": mix(t.colors.primary, base, dark ? 0.55 : 0.66),
    "--color-brand-400": t.colors.highlight,
    "--color-brand-500": mix(t.colors.primary, W, 0.12),
    "--color-brand-600": t.colors.primary,
    "--color-brand-700": dark ? mix(t.colors.primary, W, 0.3) : mix(t.colors.primary, K, 0.18),
    "--color-brand-800": dark ? mix(t.colors.primary, W, 0.45) : mix(t.colors.primary, K, 0.35),
    "--color-accent-50": mix(t.colors.accent, base, dark ? 0.82 : 0.92),
    "--color-accent-100": mix(t.colors.accent, base, dark ? 0.7 : 0.82),
    "--color-accent-600": dark ? mix(t.colors.accent, W, 0.25) : t.colors.accent,
    "--color-accent-700": dark ? mix(t.colors.accent, W, 0.4) : mix(t.colors.accent, K, 0.2),
    "--color-paper": c.background,
    "--color-surface": c.surface,
    "--color-ink": c.text,
    "--color-muted": c.muted,
    "--color-line": c.border,
    "--color-sale": t.colors.sale,
    "--page-width": `${t.layout.width}px`,
    "--radius": `${t.shape.radius}px`,
    "--radius-sm": `${Math.round(t.shape.radius * 0.6)}px`,
    "--shadow": SHADOW[t.shape.shadow as keyof typeof SHADOW] ?? "none",
    "--border-w": t.shape.borders ? "1px" : "0px",
    "--density": DENSITY[t.layout.density as keyof typeof DENSITY] ?? "1",
    "--font-size": `${t.font.size}px`,
    "--heading-weight": t.font.headingWeight,
    "--logo-h": `${t.logo.height}px`,
  };
}
export const themeCss = (t: ThemeConfig) =>
  `:root{${Object.entries(themeVars(t)).map(([k, v]) => `${k}:${v}`).join(";")}}`;

/** html data-* attributes that switch CSS variants (see globals.css). */
export const themeAttrs = (t: ThemeConfig) => ({
  "data-mode": t.mode, "data-button": t.shape.button, "data-bg": t.layout.background,
  "data-font": t.font.body, "data-heading": t.font.heading === "same" ? t.font.body : t.font.heading,
});

/** Keys whose change needs a page reload in the editor (the rest are pure CSS). */
export const CSS_ONLY = ["colors.", "shape.radius", "shape.shadow", "shape.borders", "layout.width", "layout.density",
  "font.size", "font.headingWeight", "logo.height"];
export const isCssOnly = (path: string) => CSS_ONLY.some((p) => path === p || (p.endsWith(".") && path.startsWith(p)));
