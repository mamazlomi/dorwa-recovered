// Shape of public.plan_cart_v2 (cart allocation + shipping).
type I18n = Record<string, string>;

export type PlanItem = { product_id: string; qty: number; unit_price: number; list_price: number; discount_pct: number; line_total: number };
export type PlanPharmacy = {
  pharmacy_id: string; slug: string; name_fa: string; name_i18n: I18n;
  city_fa?: string; city_i18n?: I18n;
  distance_km: number | null; items: PlanItem[]; subtotal: number;
  kind: "local" | "intercity"; provider?: "dorva" | "pharmacy"; shipping: number; shipping_full?: number; eta: "today" | "tomorrow" | "days"; min_days: number; max_days: number;
};
export type IntercityOption = {
  pharmacy_id: string; slug: string; name_fa: string; name_i18n: I18n; city_fa: string | null; city_i18n: I18n | null;
  distance_km: number; covered: number; total: number; subtotal: number; shipping: number; min_days: number; max_days: number;
};
export type Plan = {
  strategy: string; tiebreak: string; band_size: number; location_required: boolean; radius_km: number | null;
  has_location: boolean; max_pharmacies: number;
  pharmacies: PlanPharmacy[]; total: number; shipping_total: number; grand_total: number;
  unavailable: string[]; needs_prescription: string[]; intercity_options: IntercityOption[];
};
