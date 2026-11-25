import Link from "next/link";
import { formatNumber, type Locale } from "@/i18n";
import { getRound6Texts } from "@/i18n/dictionaries/round6";
import { createClient } from "@/lib/supabase/server";

/** A red reminder card on Dorva's dashboard when anything waits for approval. */
export async function InboxReminder({ locale }: { locale: Locale }) {
  const { data } = await (await createClient()).rpc("approval_inbox");
  const counts = (data as Record<string, number> | null) ?? {};
  const busy = Object.entries(counts).filter(([, n]) => Number(n) > 0);
  if (busy.length === 0) return null;
  const T = getRound6Texts(locale).inbox;
  const total = busy.reduce((a, [, n]) => a + Number(n), 0);
  return (
    <Link href={`/${locale}/admin/inbox`} className="mb-5 block rounded-2xl border border-red-300 bg-red-50 p-4 hover:bg-red-100">
      <p className="font-bold text-red-800">🔔 {T.bell.replace("{n}", formatNumber(total, locale))}</p>
      <p className="mt-1 text-sm text-red-900">{busy.map(([k, n]) => `${T.kinds[k] ?? k}: ${formatNumber(Number(n), locale)}`).join(" · ")}</p>
    </Link>
  );
}
