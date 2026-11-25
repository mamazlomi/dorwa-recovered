import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { localized, type Locale } from "@/i18n";
import { getAddressTexts } from "@/i18n/dictionaries/address";
import { deleteAddress, selectAddress } from "@/app/[locale]/account/address/actions";

type I18n = Record<string, string>;
export type SavedAddress = {
  id: string; label: string; address_line: string | null; plaque: string | null; unit: string | null;
  recipient: string | null; phone: string | null; lat: number; lng: number;
  cities: { name_fa: string; name_i18n: I18n } | null;
};
export const ADDRESS_FIELDS = "id, label, address_line, plaque, unit, recipient, phone, lat, lng, cities(name_fa, name_i18n)";

// The customer's address book: pick, edit or delete. Used on the account page
// and on the delivery-address page.
export function AddressList({ locale, saved, activeId, back, here }: {
  locale: Locale; saved: SavedAddress[]; activeId?: string;
  /** where to go after picking an address */ back: string;
  /** the page this list is on (stays here after a delete) */ here: string;
}) {
  const a = getAddressTexts(locale);
  if (saved.length === 0) return <p className="text-sm text-muted">{a.noSaved}</p>;
  const hidden = (id: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="id" value={id} />
    </>
  );
  return (
    <ul className="divide-y divide-line">
      {saved.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold">
              {s.label}
              {s.cities
                ? <span className="ms-2 text-xs font-normal text-muted">{localized(s.cities.name_fa, s.cities.name_i18n, locale)}</span>
                : <span className="chip ms-2 bg-amber-50 text-amber-800">{a.outsideShort}</span>}
            </p>
            <p className="text-xs text-muted">
              {[s.address_line, s.plaque && `${a.plaque} ${s.plaque}`, s.unit && `${a.unit} ${s.unit}`].filter(Boolean).join(" — ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeId === s.id ? <span className="chip">{a.selected}</span> : (
              <form action={selectAddress}>{hidden(s.id)}
                <SubmitButton className="btn py-1.5 text-xs">{a.select}</SubmitButton></form>
            )}
            <Link href={`/${locale}/account/address?edit=${s.id}&back=${encodeURIComponent(here)}#form`}
              className="btn-ghost py-1.5 text-xs">{a.edit}</Link>
            <form action={deleteAddress}>{hidden(s.id)}<input type="hidden" name="here" value={here} />
              <button className="btn-ghost py-1.5 text-xs text-red-700">{a.remove}</button></form>
          </div>
        </li>
      ))}
    </ul>
  );
}
