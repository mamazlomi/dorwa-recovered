import { getRound5Texts } from "@/i18n/dictionaries/round5";
import type { Locale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";

/** A visible note when a Dorva staff member (not the pharmacy's own team) is editing a pharmacy. */
export async function StaffAccessNote({ pharmacy, locale }: { pharmacy: string; locale: Locale }) {
  const { data } = await (await createClient()).rpc("my_pharmacy_access", { p_pharmacy: pharmacy });
  if (data !== "staff") return null;
  return <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{getRound5Texts(locale).staffAccess}</p>;
}
