import { NextResponse, type NextRequest } from "next/server";
import { aiEnabled, translate } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";

// Suggested English/Arabic versions of collection texts. Only for staff who
// may edit collections; nothing is saved here — the editor fills the fields.
export async function POST(req: NextRequest) {
  if (!aiEnabled()) return NextResponse.json({ error: "off" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as
    { texts?: Record<string, string>; pharmacyId?: string | null } | null;
  const texts = Object.fromEntries(
    Object.entries(body?.texts ?? {})
      .filter(([k, v]) => /^[a-z_]{1,20}$/.test(k) && typeof v === "string" && v.trim())
      .slice(0, 4),
  ) as Record<string, string>;
  const pharmacyId = typeof body?.pharmacyId === "string" && /^[0-9a-f-]{36}$/i.test(body.pharmacyId) ? body.pharmacyId : null;

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_manage_collections", { p_pharmacy: pharmacyId });
  if (allowed !== true) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const out: Record<"en" | "ar", Record<string, string>> = { en: {}, ar: {} };
  let failed = false;
  await Promise.all(
    Object.entries(texts).flatMap(([k, v]) => (["en", "ar"] as const).map(async (lang) => {
      const t = await translate(v, lang);
      if (t) out[lang][k] = t; else failed = true;
    })),
  );
  return NextResponse.json({ ...out, failed });
}

export async function GET() {
  return NextResponse.json({ enabled: aiEnabled() });
}
