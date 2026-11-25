import { redirect } from "next/navigation";
import { MapPicker } from "@/components/MapPicker";
import { SlugField } from "@/components/SlugField";
import { normalizeSlug } from "@/lib/slug";
import { getAddressTexts } from "@/i18n/dictionaries/address";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { loadMapSettings } from "@/lib/mapSettings";
import { ErrorBox, SetupNotice } from "@/components/SetupNotice";
import { isLocale, localized, resolveLocale } from "@/i18n";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Named = { name_fa: string; name_i18n: Record<string, string> };

async function register(formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const locale = isLocale(get("locale")) ? get("locale") : "fa";
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_pharmacy", {
    p_name_fa: get("name_fa"),
    p_slug: normalizeSlug(get("slug")),
    p_license_no: get("license_no"),
    p_city_id: Number(get("city_id")),
    p_address: get("address"),
    p_lat: Number(get("lat")),
    p_lng: Number(get("lng")),
    p_phone: get("phone"),
    p_tech_officer_name: get("tech_name"),
    p_tech_officer_license: get("tech_license"),
    p_insurers: formData.getAll("insurers").map(String),
  });
  if (error) {
    const code =
      error.code === "23505" ? "duplicate"
      : error.code === "23514" && /lat|lng/.test(error.message) ? "location"
      : error.code === "23514" ? "slug"
      : "generic";
    redirect(`/${locale}/pharmacy/register?error=${code}`);
  }
  redirect(`/${locale}/pharmacy/profile`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { t } = await resolveLocale(params);
  return { title: t.register.title };
}

export default async function RegisterPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/register`);
  const { error } = await searchParams;

  const supabase = await createClient();
  const [{ data: cities }, { data: insurers }, map] = await Promise.all([
    supabase.from("cities").select("id, name_fa, name_i18n").order("id"),
    supabase.from("insurers").select("code, name_fa, name_i18n").eq("active", true).order("sort"),
    loadMapSettings(supabase),
  ]);
  const a = getAddressTexts(locale);
  const r = t.register;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="card space-y-5">
        <div>
          <h1 className="text-xl font-bold">{r.title}</h1>
          <p className="mt-1 text-sm text-muted">{r.intro}</p>
        </div>
        {error && <ErrorBox message={r.errors[error] ?? r.errors.generic} />}
        <form action={register} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name_fa">{r.name}</label>
            <input id="name_fa" name="name_fa" required minLength={2} className="input" placeholder={r.namePlaceholder} />
          </div>
          <SlugField name="slug" label={r.slug} hint={r.slugHint} invalid={r.errors.slug} locale={locale} placeholder="dr-mazloomi" />
          <div>
            <label className="label" htmlFor="license_no">{r.license}</label>
            <input id="license_no" name="license_no" required dir="ltr" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="city_id">{r.city}</label>
            <select id="city_id" name="city_id" required className="input">
              {((cities as (Named & { id: number })[]) ?? []).map((c) => (
                <option key={c.id} value={c.id}>{localized(c.name_fa, c.name_i18n, locale)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="phone">{r.phone}</label>
            <input id="phone" name="phone" dir="ltr" className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="address">{r.address}</label>
            <input id="address" name="address" required className="input" />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <span className="label">{r.location}</span>
            <p className="text-xs text-muted">{getProfileTexts(locale).mapHint}</p>
            <MapPicker {...map} center={{ lat: 35.6997, lng: 51.338 }} initial={null} markers={[]} locale={locale} withAddress={false}
              labels={{ search: a.search, searchBtn: a.searchBtn, noResults: a.noResults, searchError: a.searchError,
                myLocation: a.myLocation, locating: a.locating, denied: a.denied, mapHelp: a.mapHelp,
                addressLine: a.addressLine, addressHint: a.addressHint, mapLoading: a.mapLoading }} />
          </div>
          <div>
            <label className="label" htmlFor="tech_name">{r.techName}</label>
            <input id="tech_name" name="tech_name" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="tech_license">{r.techLicense}</label>
            <input id="tech_license" name="tech_license" required dir="ltr" className="input" />
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="label">{r.insurers}</legend>
            <div className="flex flex-wrap gap-3">
              {((insurers as (Named & { code: string })[]) ?? []).map((i) => (
                <label key={i.code} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="insurers" value={i.code} /> {localized(i.name_fa, i.name_i18n, locale)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <button className="btn">{r.submit}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
