import { NextResponse, type NextRequest } from "next/server";
import { UUID_RE } from "@/lib/collections";
import { createClient } from "@/lib/supabase/server";

// Medicine finder: one anonymous "view" of a medicine or "call" click on a
// pharmacy. Nothing about the visitor is stored.
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { kind?: unknown; drug?: unknown; pharmacy?: unknown; city?: unknown } | null;
  const kind = b?.kind === "view" || b?.kind === "call" ? b.kind : null;
  const drug = typeof b?.drug === "string" && UUID_RE.test(b.drug) ? b.drug : null;
  const pharmacy = typeof b?.pharmacy === "string" && UUID_RE.test(b.pharmacy) ? b.pharmacy : null;
  const city = Number.isInteger(b?.city) ? (b?.city as number) : null;
  if (!kind || !drug || (kind === "call" && !pharmacy)) return NextResponse.json({ ok: false }, { status: 400 });
  if (/bot|crawl|spider|preview/i.test(req.headers.get("user-agent") ?? "")) return NextResponse.json({ ok: true });
  const supabase = await createClient();
  await supabase.rpc("finder_log", { p_kind: kind, p_drug: drug, p_pharmacy: pharmacy, p_city: city });
  return NextResponse.json({ ok: true });
}
