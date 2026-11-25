import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = { product_id: string; name_fa: string; irc: string | null; catalog_gtin: string | null; code: string; kind: string; approved_at: string };
const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Approved pharmacy barcodes as CSV (UTF-8 with BOM so Excel shows Persian), for the catalog team.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("code_export");
  if (error) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = (data as Row[]) ?? [];
  const csv = ["product_id,name_fa,irc,catalog_gtin,suggested_code,kind,approved_at",
    ...rows.map((r) => [r.product_id, r.name_fa, r.irc, r.catalog_gtin, r.code, r.kind, r.approved_at].map(q).join(","))].join("\r\n");
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dorva-approved-barcodes-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
