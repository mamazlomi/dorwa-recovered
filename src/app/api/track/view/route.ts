import { NextResponse, type NextRequest } from "next/server";
import { UUID_RE } from "@/lib/collections";
import { createClient } from "@/lib/supabase/server";

// Counts one product-page view. The browser sends it once per product per
// session; only a daily counter is stored, never who viewed.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && UUID_RE.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  if (/bot|crawl|spider|preview/i.test(req.headers.get("user-agent") ?? "")) return NextResponse.json({ ok: true });
  const supabase = await createClient();
  await supabase.rpc("track_view", { p_product: id });
  return NextResponse.json({ ok: true });
}
