import { cache } from "react";
import type { Locale } from "@/i18n";
import { isConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

// Catalog categories are stored as Persian paths. Their English and Arabic names
// live in category_names (edited in Dorva panel › Lists); missing ones stay Persian.
const load = cache(async (): Promise<Map<string, Record<string, string>>> => {
  if (!isConfigured) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("category_names").select("name_fa, name_i18n");
  return new Map(((data as { name_fa: string; name_i18n: Record<string, string> }[]) ?? []).map((r) => [r.name_fa, r.name_i18n]));
});

/** A function that names one category in the visitor's language. */
export async function catNamer(locale: Locale): Promise<(fa: string) => string> {
  if (locale === "fa") return (fa) => fa;
  const m = await load();
  return (fa) => m.get(fa)?.[locale] || fa;
}

/** "Supplement › Amino acids" in the visitor's language. */
export async function catPath(path: string[], locale: Locale): Promise<string> {
  const name = await catNamer(locale);
  return path.map(name).join(" › ");
}
