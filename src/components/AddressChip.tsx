import Link from "next/link";
import type { Locale } from "@/i18n";
import { getAddressTexts } from "@/i18n/dictionaries/address";
import type { ActiveAddress } from "@/lib/address";

// Shows the active delivery address with a link to change it.
export function AddressChip({ locale, address, back, guest = false }: { locale: Locale; address: ActiveAddress | null; back: string; guest?: boolean }) {
  const a = getAddressTexts(locale);
  const page = `/${locale}/account/address?back=${encodeURIComponent(back)}`;
  const href = guest ? `/${locale}/login?next=${encodeURIComponent(page)}` : page;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{a.deliverTo}:</span>
      <span className="font-semibold">{address ? address.label || a.tempLabel : a.none}</span>
      <Link href={href} className={address ? "text-brand-700 hover:underline" : "btn py-1.5 text-xs"}>
        {address ? a.change : a.pickAddress}
      </Link>
    </div>
  );
}
