// Adding a language = add an entry here + a dictionary file in ./dictionaries.
export const LOCALES = {
  fa: { label: "فارسی", dir: "rtl", intl: "fa-IR" },
  en: { label: "English", dir: "ltr", intl: "en-US" },
  ar: { label: "العربية", dir: "rtl", intl: "ar" },
} as const;

export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = "fa";
export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];
export const LOCALE_COOKIE = "dorva_locale";

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && v in LOCALES;
}

/** Pick the best supported locale from an Accept-Language header. */
export function matchLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const wanted = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return (wanted.find((w) => isLocale(w.lang))?.lang as Locale) ?? DEFAULT_LOCALE;
}

/** Localized value from a row: name_i18n[locale] when present, else the Persian original. */
export function localized(
  fa: string | null | undefined,
  i18n: Record<string, string> | null | undefined,
  locale: Locale,
): string {
  if (locale !== "fa" && i18n && i18n[locale]) return i18n[locale];
  return fa ?? "";
}

export function formatNumber(n: number | null | undefined, locale: Locale): string {
  if (n == null) return "—";
  return Number(n).toLocaleString(LOCALES[locale].intl);
}
