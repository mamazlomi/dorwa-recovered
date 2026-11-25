import type { Locale } from "../config";

// Product hub (Dorva panel › products): the extra columns, filters and bulk actions. Plain strings only.
type R = Record<string, string>;

const fa = {
  tab: "مدیریت کالاها",
  title: "مدیریت کالاها",
  intro: "همه تنظیمات لایه دوروا روی کالاها در یک جدول: انتشار، اینکه قیمت را دوروا تعیین کند یا داروخانه (و اینکه تغییر قیمت داروخانه تأیید دوروا لازم دارد یا نه)، قیمت، سقف تخفیف، کف قیمت، سقف خرید در هر سفارش، کمیسیون، تأیید مسئول فنی و برچسب نمایشی. اطلاعات پایه از کاتالوگ می‌آید و اینجا ویرایش نمی‌شود. خانه را مستقیم عوض کنید، یا ردیف‌ها را تیک بزنید و یک تغییر گروهی اعمال کنید؛ تا «ذخیره همه تغییرات» را نزنید چیزی ذخیره نمی‌شود. قیمت‌ها به تومان است. خانه خالی یعنی پیش‌فرض (ارثی).",
  columns: "ستون‌ها", clearFilters: "پاک کردن فیلترها",
  min: "کف قیمت (تومان)", maxq: "سقف خرید در هر سفارش", comm: "کمیسیون اختصاصی ٪", tech: "تأیید مسئول فنی", badge: "برچسب",
  minPh: "ندارد", maxqPh: "بدون سقف", commPh: "ارثی",
  techOpts: { "": "طبق نوع کالا", true: "لازم است", false: "لازم نیست" } as R,
  noBadge: "بدون برچسب",
  policy: "قیمت‌گذاری با",
  policies: { fixed: "دوروا (قیمت ثابت)", cap: "داروخانه، تا سقف قیمت دوروا", floor: "داروخانه، از قیمت دوروا به بالا", free: "داروخانه (آزاد)" } as R,
  pappr: "تغییر قیمت داروخانه", papprOpts: { "": "طبق تنظیم کلی", true: "با تأیید دوروا", false: "بدون تأیید" } as R,
  a_pappr: "تأیید قیمت داروخانه را بکن",
  fOwner: "قیمت‌گذار", owner: { dorva: "دوروا", pharmacy: "داروخانه" } as R,
  commEff: "کمیسیون فعلی", stock: "داروخانه دارای موجودی", codes: "کدها", gaps: "کمبودهای کاتالوگ",
  techEff: { yes: "فعلاً: لازم", no: "فعلاً: لازم نیست" } as R,
  fSub: "زیردسته", fMaker: "تولیدکننده", fSrc: "منبع", src: { api: "کاتالوگ", seed: "آزمایشی قبلی" } as R,
  fComp: "کامل بودن", comp: { yes: "کامل", no: "ناقص" } as R, fGap: "نوع کمبود",
  fPrice: "قیمت دوروا", price: { yes: "دارد", no: "ندارد" } as R, fStock: "موجودی داروخانه‌ها", stockF: { yes: "دارد", no: "ندارد" } as R,
  fBadge: "برچسب", fTech: "تأیید مسئول فنی", techF: { yes: "لازم", no: "لازم نیست" } as R,
  a_min: "کف قیمت را بکن (تومان)", a_minClear: "کف قیمت را بردار",
  a_maxq: "سقف خرید را بکن", a_maxqClear: "سقف خرید را بردار",
  a_comm: "کمیسیون اختصاصی را بکن ٪", a_commClear: "کمیسیون اختصاصی را بردار (ارثی)",
  a_tech: "تأیید مسئول فنی را بکن", a_badge: "برچسب را بکن",
  ph_maxq: "مثلاً ۳", ph_comm: "مثلاً ۴",
  errors: { rx_tech: "داروی نسخه‌ای همیشه تأیید مسئول فنی لازم دارد.", missing: "کالا پیدا نشد." } as R,
  incomplete: "ناقص",
};
type Texts = typeof fa;

const en: Texts = {
  tab: "Products", title: "Products",
  intro: "Every Dorva-layer setting of every product in one table: publishing, price and policy, discount cap, minimum price, maximum per order, commission, technical-officer approval and display badge. Base data comes from the catalog and is not edited here. Edit cells directly or tick rows and apply a bulk change; nothing is saved until “Save all changes”. Prices in Toman. An empty cell means the default (inherited).",
  columns: "Columns", clearFilters: "Clear filters",
  min: "Minimum price (Toman)", maxq: "Max per order", comm: "Own commission %", tech: "Officer approval", badge: "Badge",
  minPh: "none", maxqPh: "no limit", commPh: "inherit",
  techOpts: { "": "By product class", true: "Required", false: "Not required" },
  noBadge: "No badge",
  policy: "Priced by",
  policies: { fixed: "Dorva (fixed price)", cap: "Pharmacy, up to Dorva's price", floor: "Pharmacy, Dorva's price or above", free: "Pharmacy (free)" },
  pappr: "Pharmacy price change", papprOpts: { "": "General setting", true: "Needs Dorva approval", false: "No approval" },
  a_pappr: "Set pharmacy price approval",
  fOwner: "Priced by", owner: { dorva: "Dorva", pharmacy: "Pharmacy" },
  commEff: "Current commission", stock: "Pharmacies with stock", codes: "Codes", gaps: "Catalog gaps",
  techEff: { yes: "now: required", no: "now: not required" },
  fSub: "Subcategory", fMaker: "Manufacturer", fSrc: "Source", src: { api: "Catalog", seed: "Earlier test" },
  fComp: "Completeness", comp: { yes: "Complete", no: "Incomplete" }, fGap: "Gap",
  fPrice: "Dorva price", price: { yes: "Set", no: "Not set" }, fStock: "Pharmacy stock", stockF: { yes: "Yes", no: "No" },
  fBadge: "Badge", fTech: "Officer approval", techF: { yes: "Required", no: "Not required" },
  a_min: "Set minimum price (Toman)", a_minClear: "Remove minimum price",
  a_maxq: "Set max per order", a_maxqClear: "Remove max per order",
  a_comm: "Set own commission %", a_commClear: "Remove own commission (inherit)",
  a_tech: "Set officer approval", a_badge: "Set badge",
  ph_maxq: "e.g. 3", ph_comm: "e.g. 4",
  errors: { rx_tech: "Prescription drugs always need officer approval.", missing: "Product not found." },
  incomplete: "Incomplete",
};

const ar: Texts = { ...en, tab: "المنتجات", title: "المنتجات" };

const ALL: Record<Locale, Texts> = { fa, en, ar };
export const getHubTexts = (l: Locale) => ALL[l];
