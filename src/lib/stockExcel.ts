// Column layout of the pharmacy stock Excel file, shared by the download (route
// handler) and the upload (server action). Only the three EDIT columns are read
// back; everything else is information for the pharmacy.
export const COLS = [
  { key: "id", fa: "شناسه دوروا (تغییر ندهید)", en: "Dorva ID (do not change)", width: 38 },
  { key: "irc", fa: "کد IRC", en: "IRC", width: 18 },
  { key: "gtin", fa: "بارکد GTIN", en: "GTIN barcode", width: 16 },
  { key: "name", fa: "نام کالا", en: "Product name", width: 44 },
  { key: "name_en", fa: "نام انگلیسی", en: "English name", width: 30 },
  { key: "generic", fa: "ماده مؤثره", en: "Active ingredient", width: 24 },
  { key: "class", fa: "نوع", en: "Type", width: 14 },
  { key: "category", fa: "دسته", en: "Category", width: 30 },
  { key: "brand", fa: "برند", en: "Brand", width: 18 },
  { key: "dorva_price", fa: "قیمت دوروا (تومان)", en: "Dorva price (Toman)", width: 16 },
  { key: "policy", fa: "سیاست قیمت", en: "Price policy", width: 14 },
  { key: "cap", fa: "سقف تخفیف ٪", en: "Discount cap %", width: 12 },
  { key: "cur_qty", fa: "موجودی فعلی", en: "Current stock", width: 12 },
  { key: "cur_price", fa: "قیمت فعلی شما (تومان)", en: "Your current price (Toman)", width: 16 },
  { key: "cur_disc", fa: "تخفیف فعلی ٪", en: "Current discount %", width: 12 },
  { key: "qty", fa: "✎ موجودی جدید", en: "✎ New stock", width: 14, edit: true },
  { key: "price", fa: "✎ قیمت شما (تومان، خالی = قیمت دوروا)", en: "✎ Your price (Toman, empty = Dorva price)", width: 22, edit: true },
  { key: "disc", fa: "✎ تخفیف ٪", en: "✎ Discount %", width: 12, edit: true },
] as const;
export const COL_INDEX = Object.fromEntries(COLS.map((c, i) => [c.key, i + 1])) as Record<(typeof COLS)[number]["key"], number>;

export type TemplateRow = {
  product_id: string; irc: string | null; gtin: string | null; name_fa: string; name_en: string | null; generic_name: string | null;
  dispensing_class: string; category_path: string[]; brand: string | null; base_price: number | null; price_policy: string; cap: number;
  quantity: number | null; own_price: number | null; own_discount: number | null; price_requested: number | null;
};

/** A spreadsheet cell as plain text (numbers, formulas, rich text, hyperlinks). */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.result !== undefined) return cellText(o.result);
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return String(o.text);
  }
  return String(v);
}

/** Persian/Arabic digits and separators to a plain number string ("" when empty). */
export function normNum(s: string): string {
  return s.trim()
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬,\s]/g, "").replace(/٫/g, ".");
}
