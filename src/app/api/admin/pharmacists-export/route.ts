import { NextResponse, type NextRequest } from "next/server";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import type { Bank } from "@/lib/bank";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV of the pharmacist bank (the database function checks Dorva permission).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || null;
  const all = req.nextUrl.searchParams.get("all") === "1";
  const { data, error } = await (await createClient()).rpc("pharmacist_bank", { p_q: q, p_all: all });
  if (error || !data) return new NextResponse("not allowed", { status: 403 });
  const O = getRound5Texts("fa").officer;
  const head = ["name", "council_no", "pharmacy", "city", "degree", "specialty", "university", "grad_year", "years_total",
    ...Object.keys(O.areaOpts).map((k) => `years_${k}`), "expertise", "languages", "other_degrees", "work_history", "achievements", "consent", "has_resume"];
  const lines = (data as Bank).rows.map((r) => {
    const p = r.profile ?? {};
    return [r.full_name, r.council_no, r.pharmacy.name_fa, r.city, p.degree ? O.degrees[p.degree] ?? p.degree : "", p.specialty, p.university,
      p.grad_year, p.years_total, ...Object.keys(O.areaOpts).map((k) => p.areas?.[k] ?? ""),
      (p.expertise ?? []).map((x) => O.expertiseOpts[x] ?? x).join("، "), p.languages, p.other_degrees, p.work_history, p.achievements,
      p.consent ? "yes" : "no", r.resume ? "yes" : "no"].map(cell).join(",");
  });
  return new NextResponse("﻿" + [head.join(","), ...lines].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dorva-pharmacists.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
