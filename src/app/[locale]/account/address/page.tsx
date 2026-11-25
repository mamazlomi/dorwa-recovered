import Link from "next/link";
import { redirect } from "next/navigation";
import { ADDRESS_FIELDS, AddressList, type SavedAddress } from "@/components/AddressList";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { MapPicker } from "@/components/MapPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { localized, resolveLocale } from "@/i18n";
import { getAddressTexts } from "@/i18n/dictionaries/address";
import { readAddress } from "@/lib/address";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";
import { clearAddress, saveAddress, updateAddress } from "./actions";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Ph = { name_fa: string; name_i18n: I18n; lat: number; lng: number };
type Params = { params: Promise<{ locale: string }>; searchParams: Promise<{ back?: string; error?: string; edit?: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getAddressTexts(locale).title };
}

const TEHRAN = { lat: 35.6997, lng: 51.338 };

export default async function AddressPage({ params, searchParams }: Params) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const a = getAddressTexts(locale);
  const sp = await searchParams;
  const back = sp.back?.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "";
  const self = `/${locale}/account/address${back ? `?back=${encodeURIComponent(back)}` : ""}`;
  const supabase = await createClient();
  const [{ user }, current, { data: settingRows }, { data: phData }] = await Promise.all([
    getUser(),
    readAddress(),
    supabase.from("settings").select("key, value").eq("scope", "platform").in("key", ["map.tile_url", "map.attribution", "map.search_url"]),
    supabase.rpc("map_pharmacies", {}),
  ]);
  const setting = (k: string, d: string) => {
    const v = (settingRows as { key: string; value: unknown }[] | null)?.find((r) => r.key === k)?.value;
    return typeof v === "string" ? v : d;
  };
  const { data: savedData } = user
    ? await supabase.from("customer_addresses").select(ADDRESS_FIELDS).order("created_at", { ascending: false })
    : { data: [] };
  // guests pick an address only after signing in
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(self)}`);
  const saved = (savedData as unknown as SavedAddress[]) ?? [];
  const editing = user && isUuid(sp.edit) ? saved.find((s) => s.id === sp.edit) ?? null : null;
  const markers = ((phData as Ph[]) ?? []).map((p) => ({ lat: p.lat, lng: p.lng, name: localized(p.name_fa, p.name_i18n, locale) }));
  const start = editing ? { lat: editing.lat, lng: editing.lng } : current ? { lat: current.lat, lng: current.lng } : null;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />
    </>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {back && <Link href={back} className="text-sm text-brand-700 hover:underline">{a.back}</Link>}
      <div>
        <h1 className="text-2xl font-extrabold">{a.title}</h1>
        <p className="text-sm text-muted">{a.intro}</p>
      </div>
      {sp.error && <ErrorBox message={a.errors[sp.error] ?? a.errors.save} />}

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="text-muted">{a.current}</p>
          <p className="font-bold">{current ? current.label || a.tempLabel : a.none}</p>
          {current && !current.city && <p className="text-xs text-amber-800">{a.outside}</p>}
        </div>
        {current && (
          <form action={clearAddress}>{hidden}<button className="btn-ghost text-xs">{a.remove}</button></form>
        )}
      </section>

      {user && (
        <section className="card space-y-3">
          <h2 className="font-bold">{a.saved}</h2>
          <AddressList locale={locale} saved={saved} activeId={current?.id} back={back || `/${locale}/products`} here={self} />
        </section>
      )}

      <section id="form" className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">{editing ? `${a.editTitle}: ${editing.label}` : a.newAddress}</h2>
          {editing && <Link href={self} className="text-sm text-brand-700 hover:underline">{a.cancel}</Link>}
        </div>
        {/* key: a different address (or new) gets a fresh map and fields */}
        <form key={editing?.id ?? "new"} action={editing ? updateAddress : saveAddress} className="space-y-3">
          {hidden}
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <MapPicker
            tileUrl={setting("map.tile_url", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")}
            attribution={setting("map.attribution", "© OpenStreetMap")}
            searchUrl={setting("map.search_url", "").replace(/\/+$/, "")}
            center={TEHRAN} initial={start} initialLine={editing?.address_line ?? ""}
            markers={markers} locale={locale} withAddress={!!user}
            labels={{ search: a.search, searchBtn: a.searchBtn, noResults: a.noResults, searchError: a.searchError,
              myLocation: a.myLocation, locating: a.locating, denied: a.denied, mapHelp: a.mapHelp,
              addressLine: a.addressLine, addressHint: a.addressHint, mapLoading: a.mapLoading }} />
          <p className="text-xs text-muted">{a.gpsHint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{a.label}</span>
              <input name="label" maxLength={40} required className="input"
                defaultValue={editing?.label ?? (user ? a.defaultLabel : a.tempLabel)} placeholder={a.labelHint} />
            </label>
            {user && (
              <>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">{a.recipient}</span>
                  <input name="recipient" maxLength={80} className="input" defaultValue={editing?.recipient ?? ""} />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">{a.phone}</span>
                  <input name="phone" inputMode="tel" dir="ltr" maxLength={16} pattern="[0-9+ ]{7,16}" className="input"
                    defaultValue={editing?.phone ?? ""} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">{a.plaque}</span>
                    <input name="plaque" maxLength={20} className="input" defaultValue={editing?.plaque ?? ""} />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">{a.unit}</span>
                    <input name="unit" maxLength={20} className="input" defaultValue={editing?.unit ?? ""} />
                  </label>
                </div>
              </>
            )}
          </div>
          <SubmitButton className="btn w-full">{editing ? a.saveChanges : user ? a.saveSelect : a.useTemp}</SubmitButton>
          {!user && (
            <p className="text-xs text-muted">
              {a.guestNote}{" "}
              <Link href={`/${locale}/login?next=${encodeURIComponent(self)}`} className="text-brand-700 hover:underline">{a.login}</Link>
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
