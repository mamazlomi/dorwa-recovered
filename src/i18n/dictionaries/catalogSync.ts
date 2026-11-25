import type { Locale } from "../config";

// Catalog sync admin page and the catalog detail sections on product pages. Plain strings only.
type R = Record<string, string>;

const fa = {
  tab: "همگام‌سازی کاتالوگ",
  title: "همگام‌سازی کاتالوگ",
  intro: "اطلاعات پایه کالاها (نام، ترکیبات، متن‌ها، عکس، کدها) فقط از نرم‌افزار کاتالوگ می‌آید و در دوروا قابل ویرایش نیست. قیمت، موجودی، تاریخ انقضا و انتشار در دوروا و داروخانه‌ها می‌ماند.",
  keyTitle: "کلید اتصال به کاتالوگ",
  keyHelp: "در نرم‌افزار کاتالوگ › تنظیمات › اتصال به دوروا یک کلید بسازید و اینجا بچسبانید. کلید رمزنگاری‌شده در Supabase Vault نگه داشته می‌شود و دیگر نمایش داده نمی‌شود؛ فقط چند حرف اولش را می‌بینید.",
  keySet: "کلید ثبت شده است", keyNone: "هنوز کلیدی ثبت نشده — همگام‌سازی انجام نمی‌شود.",
  keyPlaceholder: "pk_live_…", keySave: "ثبت / جایگزینی کلید", keyClear: "حذف کلید",
  status: "وضعیت", lastOk: "آخرین همگام‌سازی موفق", lastFull: "آخرین بارگیری کامل", lastError: "آخرین خطا",
  running: "در حال اجرا…", pending: "در صف", resuming: "بارگیری کامل نیمه‌کاره است و ادامه پیدا می‌کند",
  enabled: "همگام‌سازی خودکار", on: "روشن", off: "خاموش",
  every: (m: string, h: string) => `تغییرات هر ${m} دقیقه، بارگیری کامل هر ${h} ساعت`,
  settings: "تنظیمات همگام‌سازی",
  runIncremental: "دریافت تغییرات الان", runFull: "بارگیری کامل از نو",
  fullHelp: "بارگیری کامل همه کالاهای منتشرشده را دوباره می‌خواند و کالاهایی را که در کاتالوگ دیگر منتشر نیستند در دوروا غیرفعال می‌کند.",
  oneTitle: "به‌روزرسانی یک کالا", onePlaceholder: "شناسه یا کد داخلی کاتالوگ", oneRun: "به‌روزرسانی",
  counts: "کالاها", apiActive: "از کاتالوگ (فعال)", apiOff: "از کاتالوگ (خارج از انتشار)", complete: "کامل", incomplete: "ناقص",
  seedTitle: "کالاهای آزمایشی قبلی",
  seedHelp: (a: string, t: string) => `${a} از ${t} کالای واردشده آزمایشی قبلی فعال است. داروخانه‌های آزمایشی روی همین کالاها موجودی دارند. خاموش کردن چیزی را پاک نمی‌کند و هر وقت بخواهید برمی‌گردد.`,
  seedOff: "خاموش کردن کالاهای آزمایشی", seedOn: "روشن کردن دوباره کالاهای آزمایشی",
  seedConfirm: "کالاهای آزمایشی از سایت پنهان می‌شوند (پاک نمی‌شوند). مطمئنید؟",
  missingTitle: "کمبودهای اعلام‌شده کاتالوگ", all: "همه",
  gapHelp: "روی هر مورد بزنید تا همان کالاها در «مدیریت کالاها» با جستجو و فیلتر کامل باز شوند.",
  incompleteTitle: "کالاهای ناقص", noIncomplete: "کالای ناقصی نیست.",
  runs: "دورهای اخیر", mode: { full: "کامل", incremental: "تغییرات", one: "یک کالا" } as R,
  cols: { when: "زمان", mode: "نوع", result: "نتیجه", received: "دریافتی", created: "جدید", updated: "به‌روز", unchanged: "بدون تغییر", skipped: "رد", deactivated: "غیرفعال" } as R,
  ok: "موفق", failed: "ناموفق", open: "باز",
  results: { ok: "انجام شد. چند ثانیه دیگر صفحه را تازه کنید.", queued: "یک دور در حال اجراست؛ درخواست شما بعد از آن انجام می‌شود.", no_key: "اول کلید اتصال را ثبت کنید.", format: "کلید باید با pk_ شروع شود.", id: "شناسه یا کد کالا را بنویسید.", saved: "کلید ثبت شد.", cleared: "کلید حذف شد.", seed: "انجام شد." } as R,
  gap: {
    COMPONENTS_MISSING: "ترکیبات", IMAGE_MISSING: "عکس", AI_TEXT_PENDING: "متن در صف نوشتن", SHORT_TEXT_MISSING: "متن کوتاه", LONG_TEXT_MISSING: "متن بلند",
    IRC_MISSING: "کد IRC", ERX_MISSING: "کد eRx", GTIN_MISSING: "بارکد GTIN",
    KB_TEXTS_MISSING: "متن دانش‌نامه", KB_INGREDIENT_MISSING: "ماده در دانش‌نامه نیست", INDICATIONS_MISSING: "موارد مصرف",
    STORAGE_MISSING: "شرایط نگهداری", PRECAUTIONS_MISSING: "احتیاط‌ها", DIRECTIONS_MISSING: "طریقه مصرف",
  } as R,
  // product page
  incompleteBadge: "اطلاعات این کالا در حال تکمیل است",
  sections: {
    long_description: "معرفی", indications: "موارد مصرف", directions: "طریقه مصرف", warnings: "هشدارها", precautions: "احتیاط‌ها",
    contraindications: "موارد منع مصرف", interactions: "تداخلات", side_effects: "عوارض جانبی", recommendations: "توصیه‌ها", storage: "شرایط نگهداری",
  } as R,
  components: "ترکیبات", perServing: (s: string) => `در هر ${s}`, elemental: (s: string) => `معادل ${s} عنصری`,
  codes: "کدها", healthLicense: "پروانه بهداشت", servings: (n: string) => `${n} وعده در هر بسته`,
  labels: { manufacturer: "تولیدکننده", license_holder: "صاحب پروانه", country: "کشور سازنده", dosage_form: "شکل دارویی", age: "گروه سنی", gender: "جنسیت", serving: "مقدار هر وعده" } as R,
};

type Texts = typeof fa;

const en: Texts = {
  tab: "Catalog sync",
  title: "Catalog sync",
  intro: "Base product data (names, components, texts, images, codes) comes only from the catalog software and is read-only in Dorva. Price, stock, expiry and publishing stay in Dorva and the pharmacies.",
  keyTitle: "Catalog API key",
  keyHelp: "Create a key in the catalog software › Settings › Connect to Dorva and paste it here. It is stored encrypted in Supabase Vault and never shown again; only its first characters are displayed.",
  keySet: "A key is stored", keyNone: "No key yet — nothing is synced.",
  keyPlaceholder: "pk_live_…", keySave: "Save / replace key", keyClear: "Remove key",
  status: "Status", lastOk: "Last successful sync", lastFull: "Last full load", lastError: "Last error",
  running: "Running…", pending: "Queued", resuming: "A full load is part-way and will continue",
  enabled: "Automatic sync", on: "On", off: "Off",
  every: (m: string, h: string) => `changes every ${m} min, full load every ${h} h`,
  settings: "Sync settings",
  runIncremental: "Fetch changes now", runFull: "Full reload",
  fullHelp: "A full reload reads every published product again and switches off products no longer published in the catalog.",
  oneTitle: "Refresh one product", onePlaceholder: "Catalog id or internal code", oneRun: "Refresh",
  counts: "Products", apiActive: "From catalog (active)", apiOff: "From catalog (withdrawn)", complete: "Complete", incomplete: "Incomplete",
  seedTitle: "Earlier test products",
  seedHelp: (a: string, t: string) => `${a} of ${t} earlier test-import products are active. Test pharmacies hold stock on them. Switching off deletes nothing and can be undone.`,
  seedOff: "Switch off test products", seedOn: "Switch test products back on",
  seedConfirm: "Test products will be hidden (not deleted). Continue?",
  missingTitle: "Gaps reported by the catalog", all: "All",
  gapHelp: "Click one to open those products in the product hub with full search and filters.",
  incompleteTitle: "Incomplete products", noIncomplete: "No incomplete products.",
  runs: "Recent runs", mode: { full: "Full", incremental: "Changes", one: "One product" },
  cols: { when: "When", mode: "Type", result: "Result", received: "Received", created: "New", updated: "Updated", unchanged: "Unchanged", skipped: "Skipped", deactivated: "Switched off" },
  ok: "OK", failed: "Failed", open: "Open",
  results: { ok: "Started. Refresh in a few seconds.", queued: "A run is in progress; yours follows.", no_key: "Save the API key first.", format: "The key must start with pk_.", id: "Enter a product id or code.", saved: "Key saved.", cleared: "Key removed.", seed: "Done." },
  gap: {
    COMPONENTS_MISSING: "Components", IMAGE_MISSING: "Image", AI_TEXT_PENDING: "Text queued", SHORT_TEXT_MISSING: "Short text", LONG_TEXT_MISSING: "Long text",
    IRC_MISSING: "IRC code", ERX_MISSING: "eRx code", GTIN_MISSING: "GTIN barcode",
    KB_TEXTS_MISSING: "Knowledge-base text", KB_INGREDIENT_MISSING: "Ingredient not in knowledge base", INDICATIONS_MISSING: "Uses",
    STORAGE_MISSING: "Storage", PRECAUTIONS_MISSING: "Precautions", DIRECTIONS_MISSING: "Directions",
  },
  incompleteBadge: "Information for this product is being completed",
  sections: {
    long_description: "About", indications: "Uses", directions: "How to use", warnings: "Warnings", precautions: "Precautions",
    contraindications: "Contraindications", interactions: "Interactions", side_effects: "Side effects", recommendations: "Recommendations", storage: "Storage",
  },
  components: "Components", perServing: (s: string) => `per ${s}`, elemental: (s: string) => `= ${s} elemental`,
  codes: "Codes", healthLicense: "Health license", servings: (n: string) => `${n} servings per pack`,
  labels: { manufacturer: "Manufacturer", license_holder: "License holder", country: "Country", dosage_form: "Dosage form", age: "Age group", gender: "Gender", serving: "Serving size" },
};

const ar: Texts = {
  ...en,
  tab: "مزامنة الكتالوج", title: "مزامنة الكتالوج",
  incompleteBadge: "معلومات هذا المنتج قيد الإكمال",
  sections: {
    long_description: "نبذة", indications: "الاستعمالات", directions: "طريقة الاستعمال", warnings: "تحذيرات", precautions: "احتياطات",
    contraindications: "موانع الاستعمال", interactions: "التداخلات", side_effects: "الآثار الجانبية", recommendations: "توصيات", storage: "التخزين",
  },
  components: "المكونات", codes: "الرموز",
  labels: { manufacturer: "الشركة المصنعة", license_holder: "صاحب الترخيص", country: "البلد", dosage_form: "الشكل الدوائي", age: "الفئة العمرية", gender: "الجنس", serving: "حجم الحصة" },
};

const ALL: Record<Locale, Texts> = { fa, en, ar };
export const getCatalogSyncTexts = (l: Locale) => ALL[l];
