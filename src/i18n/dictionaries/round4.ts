import type { Locale } from "../config";

// Texts added in round 4 (installable app, back-to-top, form messages,
// category names, page builder looks). All plain strings: safe for client components.
type R = Record<string, string>;

const fa = {
  form: {
    missing: "این قسمت را پر کنید.",
    pattern: "قالب واردشده درست نیست؛ راهنمای زیر همین قسمت را ببینید.",
    email: "نشانی ایمیل درست نیست (مثلاً name@gmail.com).",
    short: "کوتاه‌تر از حد لازم است.",
    range: "عدد خارج از محدوده مجاز است.",
  },
  toTop: "بالای صفحه",
  toBottom: "پایین صفحه",
  nav: { home: "خانه", products: "محصولات", finder: "دارویاب", cart: "سبد", account: "حساب من" } as R,
  quick: {
    hello: "سلام! امروز چه لازم دارید؟",
    search: "نام کالا، دارو یا برند…",
    tiles: {
      products: "همه محصولات", finder: "داروی کمیاب", pharmacies: "داروخانه‌ها", near: "نزدیک‌ترین داروخانه",
      orders: "سفارش‌های من", cart: "سبد خرید", rx: "ثبت نسخه", advice: "مشاوره داروساز",
    } as R,
    soon: "به‌زودی",
  },
  install: {
    title: "دوروا را روی گوشی نصب کنید",
    body: "مثل یک اپ از صفحه اصلی گوشی باز می‌شود؛ بدون فروشگاه اپ و بدون حجم زیاد.",
    btn: "نصب",
    later: "بعداً",
    ios: "در Safari دکمه «اشتراک‌گذاری» (مربع با فلش) و بعد «Add to Home Screen» را بزنید.",
  },
  offline: { title: "اتصال اینترنت برقرار نیست", body: "پس از وصل شدن، صفحه را دوباره باز کنید.", retry: "تلاش دوباره" },
  bulk: {
    changes: "{n} تغییر ذخیره‌نشده", saveAll: "ذخیره همه تغییرات", saving: "در حال ذخیره…", undo: "لغو تغییرات",
    selected: "{n} ردیف انتخاب‌شده:", action: "کار گروهی", amount: "مقدار", apply: "اعمال روی انتخاب‌شده‌ها", clearSel: "لغو انتخاب",
    stock_set: "موجودی را بکن", stock_add: "به موجودی اضافه/کم کن", disc_set: "درصد تخفیف را بکن",
    price_set: "قیمت را بکن (تومان)", price_pct: "قیمت را درصد بالا/پایین ببر", price_reset: "برگشت به قیمت دوروا",
    stock_set_ph: "مثلاً ۱۰", stock_add_ph: "مثلاً ۱۰ یا ‎-۵", disc_set_ph: "مثلاً ۵", price_set_ph: "تومان", price_pct_ph: "مثلاً ۱۰ یا ‎-۵",
    help: "خانه‌ها را مستقیم عوض کنید یا ردیف‌ها را تیک بزنید و کار گروهی را اعمال کنید. خانه‌های عوض‌شده زرد می‌شوند؛ تا «ذخیره همه تغییرات» را نزنید چیزی ذخیره نمی‌شود. قیمت خالی یعنی قیمت دوروا.",
    applied: "روی {n} ردیف اعمال شد؛ برای ثبت «ذخیره همه تغییرات» را بزنید.",
    pricePending: "ذخیره شد. تغییر قیمت برای تأیید دوروا فرستاده شد؛ تا تأیید، قیمت قبلی نمایش داده می‌شود.",
    savedN: "{n} ردیف ذخیره شد.", failedN: "{n} ردیف ذخیره نشد (قرمز).",
    selectAll: "انتخاب همه ردیف‌های نمایش‌داده‌شده", product: "کالا", quantity: "موجودی", price: "قیمت شما (تومان)", discount: "تخفیف شما ٪",
    cap: "سقف دوروا", customer: "مشتری می‌بیند", status: "وضعیت", dorvaPrice: "قیمت دوروا", overCap: "بیشتر از سقف",
    errDiscount: "تخفیف بیشتر از سقف دوروا ({n}٪) است.", err_price_cap: "قیمت بیشتر از سقف دوروا است.", err_price_floor: "قیمت کمتر از کف دوروا است.",
    err_value: "عدد نامعتبر.", err_missing: "این کالا در موجودی شما نیست.", err_forbidden: "اجازه ویرایش موجودی ندارید.",
    err_too_many: "حداکثر ۱۰۰۰ ردیف در هر بار.", err_unknown: "خطا؛ دوباره تلاش کنید.",
  } as R,
  cats: {
    title: "نام دسته‌ها به انگلیسی و عربی",
    intro: "دسته‌های کاتالوگ فقط نام فارسی دارند. ترجمه‌ها اینجا ثبت می‌شوند و در نسخه انگلیسی و عربی سایت (مسیر دسته روی کارت و صفحه محصول) نمایش داده می‌شوند. اگر ترجمه‌ای خالی باشد، نام فارسی نشان داده می‌شود.",
    search: "جستجو در نام دسته",
    missing: "فقط بدون ترجمه",
    fa: "نام فارسی", en: "انگلیسی", ar: "عربی", products: "کالا", save: "ذخیره", saved: "ذخیره شد.", error: "ذخیره نشد.",
    count: "{n} دسته؛ {m} بدون ترجمه کامل",
  },
};
export type Round4Texts = typeof fa;

const en: Round4Texts = {
  form: {
    missing: "Please fill in this field.",
    pattern: "This format is not accepted; see the hint below the field.",
    email: "This is not a valid email address (e.g. name@gmail.com).",
    short: "This is too short.",
    range: "This number is out of range.",
  },
  toTop: "Back to top",
  toBottom: "To the bottom",
  nav: { home: "Home", products: "Products", finder: "Finder", cart: "Cart", account: "Account" },
  quick: {
    hello: "Hello! What do you need today?",
    search: "Product, medicine or brand…",
    tiles: {
      products: "All products", finder: "Scarce medicine", pharmacies: "Pharmacies", near: "Nearest pharmacy",
      orders: "My orders", cart: "Cart", rx: "Prescription", advice: "Ask a pharmacist",
    },
    soon: "Soon",
  },
  install: {
    title: "Install Dorva on your phone",
    body: "Opens from your home screen like an app; no app store, tiny download.",
    btn: "Install",
    later: "Later",
    ios: "In Safari tap Share (square with arrow), then “Add to Home Screen”.",
  },
  offline: { title: "You are offline", body: "Open the page again once you are connected.", retry: "Try again" },
  bulk: {
    changes: "{n} unsaved changes", saveAll: "Save all changes", saving: "Saving…", undo: "Discard changes",
    selected: "{n} rows selected:", action: "Bulk action", amount: "Amount", apply: "Apply to selected", clearSel: "Clear selection",
    stock_set: "Set stock to", stock_add: "Add to stock (or subtract)", disc_set: "Set discount % to",
    price_set: "Set price to (Toman)", price_pct: "Change price by %", price_reset: "Back to Dorva price",
    stock_set_ph: "e.g. 10", stock_add_ph: "e.g. 10 or -5", disc_set_ph: "e.g. 5", price_set_ph: "Toman", price_pct_ph: "e.g. 10 or -5",
    help: "Edit cells directly, or tick rows and apply a bulk action. Changed cells turn yellow; nothing is saved until “Save all changes”. An empty price means Dorva's price.",
    applied: "Applied to {n} rows; press “Save all changes” to keep it.",
    pricePending: "Saved. Price changes were sent to Dorva for approval; the previous price shows until then.",
    savedN: "{n} rows saved.", failedN: "{n} rows not saved (red).",
    selectAll: "Select all shown rows", product: "Product", quantity: "Stock", price: "Your price (Toman)", discount: "Your discount %",
    cap: "Dorva cap", customer: "Customer sees", status: "Status", dorvaPrice: "Dorva price", overCap: "Above the cap",
    errDiscount: "Discount is above Dorva's cap ({n}%).", err_price_cap: "Price is above Dorva's cap.", err_price_floor: "Price is below Dorva's floor.",
    err_value: "Invalid number.", err_missing: "Not in your stock.", err_forbidden: "You may not edit stock.",
    err_too_many: "At most 1000 rows at a time.", err_unknown: "Error; try again.",
  },
  cats: {
    title: "Category names in English and Arabic",
    intro: "Catalog categories only have Persian names. Translations entered here are shown on the English and Arabic site; an empty one falls back to Persian.",
    search: "Search categories",
    missing: "Untranslated only",
    fa: "Persian", en: "English", ar: "Arabic", products: "Products", save: "Save", saved: "Saved.", error: "Not saved.",
    count: "{n} categories; {m} not fully translated",
  },
};

const ar: Round4Texts = {
  ...en,
  form: {
    missing: "يرجى ملء هذا الحقل.",
    pattern: "هذه الصيغة غير مقبولة؛ راجع التلميح أسفل الحقل.",
    email: "عنوان البريد غير صحيح (مثلاً name@gmail.com).",
    short: "هذا قصير جداً.",
    range: "الرقم خارج النطاق المسموح.",
  },
  toTop: "إلى الأعلى",
  toBottom: "إلى الأسفل",
  nav: { home: "الرئيسية", products: "المنتجات", finder: "البحث عن دواء", cart: "السلة", account: "حسابي" },
  quick: {
    hello: "مرحباً! ماذا تحتاج اليوم؟",
    search: "منتج أو دواء أو علامة…",
    tiles: {
      products: "كل المنتجات", finder: "دواء نادر", pharmacies: "الصيدليات", near: "أقرب صيدلية",
      orders: "طلباتي", cart: "السلة", rx: "وصفة طبية", advice: "اسأل الصيدلي",
    },
    soon: "قريباً",
  },
  install: {
    title: "ثبّت دوروا على هاتفك",
    body: "يفتح من الشاشة الرئيسية مثل التطبيق؛ دون متجر تطبيقات وبحجم صغير.",
    btn: "تثبيت",
    later: "لاحقاً",
    ios: "في Safari اضغط «مشاركة» ثم «إضافة إلى الشاشة الرئيسية».",
  },
  offline: { title: "لا يوجد اتصال بالإنترنت", body: "افتح الصفحة مجدداً بعد الاتصال.", retry: "إعادة المحاولة" },
};

const ALL: Record<Locale, Round4Texts> = { fa, en, ar };
export const getRound4Texts = (l: Locale) => ALL[l];
