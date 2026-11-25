import { notFound } from "next/navigation";
import { isLocale, type Locale } from "./config";
import ar from "./dictionaries/ar";
import en from "./dictionaries/en";
import fa, { type Dict } from "./dictionaries/fa";

const DICTIONARIES: Record<Locale, Dict> = { fa, en, ar };

export function getDictionary(locale: Locale): Dict {
  return DICTIONARIES[locale];
}

/** For pages: validates the [locale] segment and returns it with its dictionary. */
export async function resolveLocale(params: Promise<{ locale: string }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, t: getDictionary(locale) };
}

export function formatMoney(rial: number | null | undefined, locale: Locale): string {
  if (rial == null) return "—";
  const intl = locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US";
  return `${Math.round(Number(rial) / 10).toLocaleString(intl)} ${getDictionary(locale).common.currency}`;
}

export * from "./config";
export type { Dict };
