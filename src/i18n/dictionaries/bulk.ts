import type { Locale } from "../config";

// Bulk editing screens in the Dorva panel (prices & publishing, price requests,
// discount caps). Plain strings only: passed to client components.
type R = Record<string, string>;

const fa = {
  grid: {
    search: "جستجو", all: "همه", onlyChanged: "فقط تغییرکرده‌ها", item: "مورد",
    changes: "{n} تغییر ذخیره‌نشده", saveAll: "ذخیره همه تغییرات", saving: "در حال ذخیره…", undo: "لغو تغییرات",
    selected: "{n} ردیف انتخاب‌شده:", action: "کار گروهی", amount: "مقدار", choose: "انتخاب کنید", apply: "اعمال روی انتخاب‌شده‌ها", clearSel: "لغو انتخاب",
    help: "خانه‌ها را مستقیم عوض کنید یا ردیف‌ها را تیک بزنید (تیک بالای جدول = همه ردیف‌های فیلترشده) و کار گروهی را اعمال کنید. خانه‌های عوض‌شده زرد می‌شوند؛ تا «ذخیره همه تغییرات» را نزنید چیزی ذخیره نمی‌شود.",
    applied: "روی {n} ردیف اعمال شد؛ برای ثبت «ذخیره همه تغییرات» را بزنید.", savedN: "{n} ردیف ذخیره شد.", failedN: "{n} ردیف ذخیره نشد (قرمز).",
    shown: "{n} از {m} ردیف", selectAll: "انتخاب همه ردیف‌های فیلترشده", more: "نمایش بیشتر ({n} ردیف دیگر)",
  } as R,
  errors: {
    value: "عدد نامعتبر.", needs_price: "برای انتشار با قیمت ثابت/سقف/کف، قیمت دوروا لازم است.", forbidden: "اجازه این کار را ندارید.",
    missing: "پیدا نشد.", too_many: "حداکثر ۲۰۰۰ ردیف در هر بار.", unknown: "خطا؛ دوباره تلاش کنید.",
  } as R,
  prices: {
    tab: "مدیریت کالاها",
    title: "کالاها: انتشار و قیمت",
    intro: "مرکز مدیریت کالاها در پنل دوروا. اطلاعات پایه کالا (نام، دسته، برند، IRC/GTIN، تصویر) از سامانه کاتالوگ‌سازی می‌آید و اینجا ویرایش نمی‌شود؛ اینجا تعیین می‌کنید کدام کالا منتشر شود، با چه قیمت و سیاست قیمت و چه سقف تخفیفی. درخواست‌های تغییر قیمت داروخانه‌ها هم در همین صفحه است. قیمت دوروا، سیاست قیمت، انتشار و سقف تخفیف اختصاصی همه کالاها در یک جدول. قیمت‌ها به تومان است. سقف تخفیف خالی یعنی سقف دسته/برند/نوع کالا اعمال می‌شود (ستون «سقف فعلی»).",
    published: "منتشر", price: "قیمت دوروا (تومان)", policy: "سیاست قیمت", cap: "سقف تخفیف اختصاصی ٪", capPh: "ارثی",
    effCap: "سقف فعلی", pharmacies: "داروخانه دارای موجودی", noPrice: "بدون قیمت",
    policies: { fixed: "ثابت (همه یک قیمت)", cap: "سقف (داروخانه کمتر یا برابر)", floor: "کف (داروخانه بیشتر یا برابر)", free: "آزاد (قیمت داروخانه)" } as R,
    capSource: { product: "اختصاصی", facet: "برند/ویژگی", category: "دسته", class: "نوع کالا" } as R,
    fClass: "نوع کالا", fCat: "دسته", fBrand: "برند", fPub: "انتشار", pubYes: "منتشرشده", pubNo: "منتشرنشده",
    a_pub: "منتشر کن", a_unpub: "از انتشار خارج کن", a_price: "قیمت را بکن (تومان)", a_pricePct: "قیمت را درصد بالا/پایین ببر",
    a_policy: "قیمت‌گذاری را بکن (دوروا/داروخانه)", a_cap: "سقف تخفیف اختصاصی را بکن ٪", a_capClear: "سقف اختصاصی را بردار (ارثی)",
    ph_price: "تومان", ph_pct: "مثلاً ۱۰ یا ‎-۵", ph_cap: "مثلاً ۱۰",
    noAccess: "برای این صفحه دسترسی «انتشار کاتالوگ» یا «سیاست قیمت» لازم است.",
  },
  requests: {
    title: "درخواست‌های تغییر قیمت داروخانه‌ها",
    intro: "قیمتی که داروخانه وارد می‌کند تا تأیید دوروا اعمال نمی‌شود و قیمت قبلی می‌ماند. «تأیید برای همین داروخانه»: فقط قیمت همان داروخانه عوض می‌شود. «تأیید برای همه داروخانه‌ها»: قیمت درخواستی قیمت دوروا برای آن کالا می‌شود و قیمت اختصاصی همه داروخانه‌ها برای آن کالا پاک می‌شود. روشن/خاموش در «تنظیمات › کاتالوگ».",
    empty: "درخواستی در انتظار نیست.",
    pharmacy: "داروخانه", product: "کالا", current: "قیمت فعلی", requested: "قیمت درخواستی", dorva: "قیمت دوروا", change: "تغییر", when: "زمان",
    approveThis: "تأیید برای همین داروخانه", approveAll: "تأیید برای همه داروخانه‌ها", reject: "رد", notePh: "دلیل رد (برای داروخانه نمایش داده می‌شود)",
    noteNeeded: "برای رد، دلیل بنویسید.", done: "{n} درخواست انجام شد.", selectAll: "انتخاب همه", selected: "{n} انتخاب‌شده",
    confirmAll: "قیمت دوروا برای کالاهای انتخاب‌شده عوض و قیمت اختصاصی همه داروخانه‌ها برای آن‌ها پاک می‌شود. ادامه می‌دهید؟",
  },
  caps: {
    title: "ویرایش گروهی سقف‌ها",
    intro: "همه سقف‌های تعریف‌شده در یک جدول: درصد و فعال/غیرفعال را مستقیم یا گروهی عوض کنید و یک‌جا ذخیره کنید. سقف جدید را با فرم پایین اضافه کنید.",
    pct: "سقف ٪", active: "فعال", scope: "نوع", updated: "آخرین تغییر",
    a_set: "سقف را بکن ٪", a_add: "سقف را کم/زیاد کن (واحد درصد)", a_on: "فعال کن", a_off: "غیرفعال کن",
  },
  stock: {
    pending: "در انتظار تأیید دوروا: {p}", rejected: "قیمت پیشنهادی رد شد: {n}",
  },
};
export type BulkTexts = typeof fa;

const en: BulkTexts = {
  grid: {
    search: "Search", all: "All", onlyChanged: "Changed only", item: "Item",
    changes: "{n} unsaved changes", saveAll: "Save all changes", saving: "Saving…", undo: "Discard changes",
    selected: "{n} rows selected:", action: "Bulk action", amount: "Amount", choose: "Choose", apply: "Apply to selected", clearSel: "Clear selection",
    help: "Edit cells directly, or tick rows (the header tick selects all filtered rows) and apply a bulk action. Changed cells turn yellow; nothing is saved until “Save all changes”.",
    applied: "Applied to {n} rows; press “Save all changes” to keep it.", savedN: "{n} rows saved.", failedN: "{n} rows not saved (red).",
    shown: "{n} of {m} rows", selectAll: "Select all filtered rows", more: "Show more ({n} more rows)",
  },
  errors: {
    value: "Invalid number.", needs_price: "Publishing with a fixed/cap/floor policy needs a Dorva price.", forbidden: "You may not do this.",
    missing: "Not found.", too_many: "At most 2000 rows at a time.", unknown: "Error; try again.",
  },
  prices: {
    tab: "Products", title: "Products",
    intro: "Dorva's product hub. Base product data (name, category, brand, IRC/GTIN, image) comes from the cataloging system and is not edited here; here you decide what is published, at what price and policy, and with which discount cap. Pharmacies' price-change requests are on this page too. Dorva price, price policy, publishing and each product's own discount cap, all in one table. Prices in Toman. An empty cap means the category/brand/class cap applies (see “Current cap”).",
    published: "Published", price: "Dorva price (Toman)", policy: "Price policy", cap: "Own discount cap %", capPh: "inherit",
    effCap: "Current cap", pharmacies: "Pharmacies with stock", noPrice: "No price",
    policies: { fixed: "Fixed (one price)", cap: "Cap (pharmacy ≤)", floor: "Floor (pharmacy ≥)", free: "Free (pharmacy price)" },
    capSource: { product: "own", facet: "brand/facet", category: "category", class: "class" },
    fClass: "Class", fCat: "Category", fBrand: "Brand", fPub: "Publishing", pubYes: "Published", pubNo: "Not published",
    a_pub: "Publish", a_unpub: "Unpublish", a_price: "Set price to (Toman)", a_pricePct: "Change price by %",
    a_policy: "Set price policy", a_cap: "Set own discount cap %", a_capClear: "Remove own cap (inherit)",
    ph_price: "Toman", ph_pct: "e.g. 10 or -5", ph_cap: "e.g. 10",
    noAccess: "This page needs the catalog publishing or pricing policy permission.",
  },
  requests: {
    title: "Pharmacy price change requests",
    intro: "A price a pharmacy enters waits for Dorva; the previous price stays live. “Approve for this pharmacy” changes only that pharmacy's price. “Approve for all pharmacies” makes the requested price Dorva's price for the product and clears every pharmacy's own price for it. On/off in Settings › Catalog.",
    empty: "No pending requests.",
    pharmacy: "Pharmacy", product: "Product", current: "Current price", requested: "Requested", dorva: "Dorva price", change: "Change", when: "When",
    approveThis: "Approve for this pharmacy", approveAll: "Approve for all pharmacies", reject: "Reject", notePh: "Reason (shown to the pharmacy)",
    noteNeeded: "Write a reason to reject.", done: "{n} requests done.", selectAll: "Select all", selected: "{n} selected",
    confirmAll: "Dorva's price for the selected products changes and every pharmacy's own price for them is cleared. Continue?",
  },
  caps: {
    title: "Bulk-edit caps",
    intro: "Every cap in one table: change the % and active state directly or in bulk, then save once. Add new caps with the form below.",
    pct: "Cap %", active: "Active", scope: "Type", updated: "Last change",
    a_set: "Set cap %", a_add: "Raise/lower cap (points)", a_on: "Activate", a_off: "Deactivate",
  },
  stock: { pending: "Waiting for Dorva: {p}", rejected: "Proposed price rejected: {n}" },
};

const ALL: Record<Locale, BulkTexts> = { fa, en, ar: en };
export const getBulkTexts = (l: Locale) => ALL[l];
