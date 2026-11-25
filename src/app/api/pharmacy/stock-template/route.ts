import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COLS, COL_INDEX, type TemplateRow } from "@/lib/stockExcel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLASS: Record<string, Record<string, string>> = {
  fa: { general: "عمومی", supplement: "مکمل", otc: "بدون نسخه", rx: "نسخه‌ای" },
  en: { general: "General", supplement: "Supplement", otc: "OTC", rx: "Prescription" },
};
const POLICY: Record<string, Record<string, string>> = {
  fa: { fixed: "ثابت", cap: "سقف", floor: "کف", free: "آزاد" },
  en: { fixed: "Fixed", cap: "Cap", floor: "Floor", free: "Free" },
};
const GUIDE: Record<string, string[]> = {
  fa: [
    "راهنمای فایل موجودی دوروا",
    "فقط سه ستون زرد را پر یا عوض کنید: «موجودی جدید»، «قیمت شما» و «تخفیف ٪». بقیه ستون‌ها فقط برای اطلاع است و تغییرشان اثری ندارد.",
    "ستون «شناسه دوروا» را تغییر ندهید و ردیف‌ها را حذف یا جابه‌جا نکنید (مرتب‌سازی و فیلتر کل ردیف اشکالی ندارد).",
    "قیمت‌ها به تومان است. «قیمت شما» خالی = قیمت دوروا. هر قیمت اختصاصی تا تأیید دوروا اعمال نمی‌شود.",
    "تخفیف نباید از «سقف تخفیف ٪» بیشتر باشد.",
    "کالایی که موجودی جدیدش خالی یا صفر باشد و در موجودی شما نباشد، نادیده گرفته می‌شود.",
    "بعد از بارگذاری، پیش‌نمایش تغییرات نمایش داده می‌شود و تا تأیید شما چیزی ذخیره نمی‌شود.",
  ],
  en: [
    "Dorva stock file guide",
    "Fill or change only the three yellow columns: “New stock”, “Your price” and “Discount %”. Other columns are information only; changing them has no effect.",
    "Do not change the “Dorva ID” column and do not delete rows (sorting and filtering whole rows is fine).",
    "Prices are in Toman. An empty “Your price” = Dorva price. Own prices apply only after Dorva approves them.",
    "Discount must not exceed “Discount cap %”.",
    "A product not in your stock whose new stock is empty or zero is ignored.",
    "After uploading you see a preview; nothing is saved until you confirm.",
  ],
};

// The pharmacy's stock Excel file: every product it may sell, with codes, prices,
// caps and its current stock, plus three yellow columns to fill in.
export async function GET(req: NextRequest) {
  const ph = req.nextUrl.searchParams.get("ph") ?? "";
  const lang = req.nextUrl.searchParams.get("locale") === "fa" ? "fa" : req.nextUrl.searchParams.get("locale") ? "en" : "fa";
  if (!/^[0-9a-f-]{36}$/.test(ph)) return NextResponse.json({ error: "pharmacy" }, { status: 400 });
  const supabase = await createClient();
  const [{ data, error }, { data: phData }] = await Promise.all([
    supabase.rpc("stock_template", { p_pharmacy: ph }),
    supabase.from("pharmacies").select("slug").eq("id", ph).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "error" }, { status: error.code === "42501" ? 403 : 500 });
  const rows = (data as TemplateRow[]) ?? [];
  const toman = (rial: number | null) => (rial ? Math.round(Number(rial) / 10) : null);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Dorva";
  const ws = wb.addWorksheet(lang === "fa" ? "کالاها" : "Products", { views: [{ rightToLeft: lang === "fa", state: "frozen", ySplit: 1, xSplit: 0 }] });
  ws.columns = COLS.map((c) => ({ header: c[lang], key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.height = 34;
  head.eachCell((cell, n) => {
    const edit = "edit" in COLS[n - 1];
    cell.font = { bold: true, color: { argb: edit ? "FF5A3E00" : "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: edit ? "FFFFD966" : "FF0E76A8" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  rows.forEach((r) => {
    const row = ws.addRow({
      id: r.product_id, irc: r.irc ?? "", gtin: r.gtin ?? "", name: r.name_fa, name_en: r.name_en ?? "", generic: r.generic_name ?? "",
      class: CLASS[lang][r.dispensing_class] ?? r.dispensing_class, category: r.category_path.join(" › "), brand: r.brand ?? "",
      dorva_price: toman(r.base_price), policy: POLICY[lang][r.price_policy] ?? r.price_policy, cap: Number(r.cap),
      cur_qty: r.quantity, cur_price: toman(r.own_price), cur_disc: r.own_discount == null ? null : Number(r.own_discount),
      qty: r.quantity, price: toman(r.price_requested ?? r.own_price), disc: r.own_discount == null ? null : Number(r.own_discount),
    });
    // codes stay text, so Excel does not turn a barcode into 6.26E+12
    [COL_INDEX.irc, COL_INDEX.gtin].forEach((i) => { row.getCell(i).numFmt = "@"; });
    [COL_INDEX.dorva_price, COL_INDEX.cur_price, COL_INDEX.price].forEach((i) => { row.getCell(i).numFmt = "#,##0"; });
    for (const k of ["qty", "price", "disc"] as const) {
      const cell = row.getCell(COL_INDEX[k]);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    }
    row.getCell(COL_INDEX.qty).dataValidation = { type: "whole", operator: "between", allowBlank: true, formulae: [0, 100000], showErrorMessage: true,
      error: lang === "fa" ? "عدد صحیح ۰ یا بیشتر" : "Whole number, 0 or more" };
    row.getCell(COL_INDEX.price).dataValidation = { type: "whole", operator: "greaterThan", allowBlank: true, formulae: [0], showErrorMessage: true,
      error: lang === "fa" ? "قیمت به تومان، عدد مثبت" : "Price in Toman, a positive number" };
    row.getCell(COL_INDEX.disc).dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [0, Number(r.cap)], showErrorMessage: true,
      error: lang === "fa" ? `تخفیف بین ۰ و ${Number(r.cap)}٪` : `Discount between 0 and ${Number(r.cap)}%` };
    if (r.dispensing_class === "rx") row.getCell(COL_INDEX.class).font = { color: { argb: "FFB00020" } };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
  ws.getColumn(COL_INDEX.id).font = { color: { argb: "FF9AA8B6" }, size: 8 };

  const guide = wb.addWorksheet(lang === "fa" ? "راهنما" : "Guide", { views: [{ rightToLeft: lang === "fa" }] });
  guide.getColumn(1).width = 110;
  GUIDE[lang].forEach((t, i) => {
    const c = guide.getCell(i + 1, 1);
    c.value = i === 0 ? t : `${i}. ${t}`;
    c.alignment = { wrapText: true, vertical: "top" };
    if (i === 0) c.font = { bold: true, size: 14, color: { argb: "FF0E76A8" } };
  });

  const buf = await wb.xlsx.writeBuffer();
  const day = new Date().toISOString().slice(0, 10);
  const slug = (phData as { slug: string } | null)?.slug ?? "pharmacy";
  return new NextResponse(buf as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dorva-stock-${slug}-${day}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
