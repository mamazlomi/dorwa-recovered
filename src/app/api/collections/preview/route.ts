import { NextResponse, type NextRequest } from "next/server";
import { isLocale, localized } from "@/i18n";
import { parseRules, UUID_RE } from "@/lib/collections";
import { createClient } from "@/lib/supabase/server";

type Row = { product_id: string; name_fa: string; name_i18n: Record<string, string>; min_price: number | null;
  max_discount: number | null; in_stock: boolean; total: number };

const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((x) => UUID_RE.test(x)).slice(0, 500) : []);

// Live preview of unsaved collection rules. The database checks permission.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const rules = parseRules(JSON.stringify(body?.rules ?? []));
  if (!rules) return NextResponse.json({ error: "bad" }, { status: 400 });
  const locale = typeof body?.locale === "string" && isLocale(body.locale) ? body.locale : "fa";
  const pharmacyId = typeof body?.pharmacyId === "string" && UUID_RE.test(body.pharmacyId) ? body.pharmacyId : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collection_preview", {
    p_rules: rules, p_include: ids(body?.include), p_exclude: ids(body?.exclude),
    p_only_discounted: body?.onlyDiscounted === true, p_pharmacy: pharmacyId, p_limit: 10,
  });
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  const rows = (data as Row[]) ?? [];
  return NextResponse.json({
    total: rows[0]?.total ?? 0,
    items: rows.map((r) => ({
      id: r.product_id, name: localized(r.name_fa, r.name_i18n, locale),
      price: r.min_price, discount: Number(r.max_discount ?? 0), inStock: r.in_stock,
    })),
  });
}
