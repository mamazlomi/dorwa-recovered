import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney, formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Status = {
  mode: string; allowed: boolean; active: boolean; reach_km: number;
  bounds: { base_fee_max: number; per_km_max: number; radius_max: number; free_over_min: number };
  dorva: { base_fee: number; per_km: number; free_over: number; same_day_km: number; cutoff: number };
};
type Row = {
  own_courier: boolean; base_fee_rial: number | null; per_km_rial: number | null; free_over_rial: number;
  radius_km: number | null; same_day_km: number | null; cutoff_hour: number | null; intercity_accept: boolean;
};

// form numbers: empty = null (use Dorva's value); money in Toman -> Rial
const num = (f: FormData, k: string, toRial = false) => {
  const s = String(f.get(k) ?? "").replace(/[٫,]/g, ".").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (toRial ? Math.round(n * 10) : n) : NaN;
};

async function save(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const ph = formData.get("pharmacy_id");
  if (!isUuid(ph)) redirect(`/${locale}/pharmacy/dashboard`);
  const vals = {
    p_base_fee: num(formData, "base_fee", true), p_per_km: num(formData, "per_km", true),
    p_free_over: num(formData, "free_over", true) ?? 0, p_radius: num(formData, "radius"),
    p_same_day_km: num(formData, "same_day_km"), p_cutoff: num(formData, "cutoff"),
  };
  if (Object.values(vals).some((v) => Number.isNaN(v))) redirect(`/${locale}/pharmacy/shipping?ph=${ph}&err=unknown`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacy_shipping_save", {
    p_pharmacy: ph, p_own_courier: formData.get("own_courier") === "on", p_intercity: formData.get("intercity") === "on",
    ...vals, p_cutoff: vals.p_cutoff == null ? null : Math.round(vals.p_cutoff),
  });
  const r = error ? (error.code === "42501" ? "forbidden" : "unknown") : String(data);
  redirect(`/${locale}/pharmacy/shipping?ph=${ph}&${r === "ok" ? "ok=1" : `err=${r}`}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getLogisticsTexts(locale).title };
}

export default async function PharmacyShippingPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ph?: string; ok?: string; err?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const L = getLogisticsTexts(locale);
  const sp = await searchParams;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/shipping`);
  const supabase = await createClient();

  const { data: mem } = await supabase.from("memberships").select("pharmacy_id").eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phId = isUuid(sp.ph) ? sp.ph : (mem as { pharmacy_id: string }[] | null)?.[0]?.pharmacy_id;
  if (!phId) redirect(`/${locale}/pharmacy/dashboard`);

  const [{ data: phData }, { data: stData }, { data: rowData }] = await Promise.all([
    supabase.from("pharmacies").select("id, name_fa, name_i18n").eq("id", phId).maybeSingle(),
    supabase.rpc("pharmacy_shipping_status", { p_pharmacy: phId }),
    supabase.from("pharmacy_shipping").select("*").eq("pharmacy_id", phId).maybeSingle(),
  ]);
  const ph = phData as { id: string; name_fa: string; name_i18n: I18n } | null;
  const st = stData as Status | null;
  if (!ph || !st) return <div className="card max-w-xl"><p className="text-sm">{L.errors.forbidden}</p></div>;
  const row = rowData as Row | null;
  const fmt = (n: number) => formatNumber(n, locale);
  const toman = (rial: number | null | undefined) => (rial == null ? "" : String(Number(rial) / 10));
  const state = st.mode !== "pharmacy_allowed" ? L.modeDorva : !st.allowed ? L.notAllowed : st.active ? L.active : L.inactiveAllowed;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/${locale}/pharmacy/dashboard?ph=${ph.id}`} className="text-sm text-brand-700 hover:underline">
        {localized(ph.name_fa, ph.name_i18n, locale)}
      </Link>
      <h1 className="text-2xl font-extrabold">{L.title}</h1>
      {sp.ok && <OkBox message={L.saved} />}
      {sp.err && <ErrorBox message={L.errors[sp.err] ?? L.errors.unknown} />}
      <p className={`rounded-xl p-3 text-sm ${st.active ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-900"}`}>{state}</p>

      <form action={save} className="card space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="pharmacy_id" value={ph.id} />
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" name="own_courier" defaultChecked={row?.own_courier ?? false} /> {L.ownCourier}
        </label>
        <p className="text-xs text-muted">{L.blankHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">{L.baseFee}</span>
            <input name="base_fee" type="number" min={0} max={st.bounds.base_fee_max / 10} className="input" dir="ltr" defaultValue={toman(row?.base_fee_rial)} />
            <span className="text-xs text-muted">{L.max(formatMoney(st.bounds.base_fee_max, locale))} · {L.dorvaValue(formatMoney(st.dorva.base_fee, locale))}</span>
          </label>
          <label><span className="label">{L.perKm}</span>
            <input name="per_km" type="number" min={0} max={st.bounds.per_km_max / 10} className="input" dir="ltr" defaultValue={toman(row?.per_km_rial)} />
            <span className="text-xs text-muted">{L.max(formatMoney(st.bounds.per_km_max, locale))} · {L.dorvaValue(formatMoney(st.dorva.per_km, locale))}</span>
          </label>
          <label><span className="label">{L.freeOver}</span>
            <input name="free_over" type="number" min={0} className="input" dir="ltr" defaultValue={toman(row?.free_over_rial ?? 0)} />
            {Number(st.bounds.free_over_min) > 0 && <span className="text-xs text-muted">{L.min(formatMoney(st.bounds.free_over_min, locale))}</span>}
          </label>
          <label><span className="label">{L.radius}</span>
            <input name="radius" type="number" min={0.5} step="0.5" max={st.bounds.radius_max} className="input" dir="ltr" defaultValue={row?.radius_km ?? ""} />
            <span className="text-xs text-muted">{L.max(fmt(Number(st.bounds.radius_max)))}</span>
          </label>
          <label><span className="label">{L.sameDayKm}</span>
            <input name="same_day_km" type="number" min={0.5} step="0.5" className="input" dir="ltr" defaultValue={row?.same_day_km ?? ""} />
            <span className="text-xs text-muted">{L.dorvaValue(fmt(Number(st.dorva.same_day_km)))}</span>
          </label>
          <label><span className="label">{L.cutoff}</span>
            <input name="cutoff" type="number" min={0} max={24} className="input" dir="ltr" defaultValue={row?.cutoff_hour ?? ""} />
            <span className="text-xs text-muted">{L.dorvaValue(fmt(Number(st.dorva.cutoff)))}</span>
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="intercity" defaultChecked={row?.intercity_accept ?? true} /> {L.intercity}
        </label>
        <p className="text-xs text-muted">{L.intercityHelp}</p>
        <p className="text-xs text-muted">{L.fairness}</p>
        <SubmitButton className="btn">{L.save}</SubmitButton>
      </form>
    </div>
  );
}
