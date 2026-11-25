import type { Locale } from "../config";

// Inventory tools: Excel template/import, barcode scanner, data enrichment.
// Plain strings only ({x} placeholders): passed to client components.
type R = Record<string, string>;

const fa = {
  excel: {
    title: "موجودی با فایل اکسل",
    intro: "۱) فایل اکسل را دانلود کنید: همه کالاهای دوروا با کد IRC، بارکد GTIN، نام، ماده مؤثره، دسته، برند، قیمت دوروا، سقف تخفیف و موجودی فعلی شما. ۲) فقط سه ستون زرد (موجودی جدید، قیمت شما، تخفیف) را پر یا عوض کنید. ۳) فایل را بارگذاری کنید؛ پیش‌نمایش تغییرات را ببینید و بعد تأیید کنید.",
    download: "دانلود فایل اکسل کالاها",
    upload: "بارگذاری فایل پرشده",
    reading: "در حال خواندن فایل…",
    badFile: "فایل خوانده نشد. همان فایلی را که از اینجا دانلود کرده‌اید (xlsx) بارگذاری کنید.",
    preview: "پیش‌نمایش تغییرات",
    counts: "{new} کالای جدید، {upd} ردیف تغییر، {same} بدون تغییر، {err} خطا، {price} تغییر قیمت (در انتظار تأیید دوروا)",
    kinds: { new: "جدید", update: "تغییر", error: "خطا" } as R,
    colProduct: "کالا", colKind: "نوع", colQty: "موجودی", colPrice: "قیمت (تومان)", colDisc: "تخفیف ٪", colNote: "توضیح",
    dorvaPrice: "قیمت دوروا", priceWait: "قیمت منتظر تأیید دوروا",
    confirm: "تأیید و ذخیره {n} ردیف", cancel: "انصراف", saving: "در حال ذخیره…",
    done: "{n} ردیف ذخیره شد.", failed: "{n} ردیف ذخیره نشد.",
    nothing: "در فایل تغییری نسبت به موجودی فعلی نیست.",
    e: { value: "عدد نامعتبر", discount: "تخفیف بیشتر از سقف ({n}٪)", product: "کالا در دوروا پیدا نشد", price_cap: "قیمت بیشتر از سقف دوروا", price_floor: "قیمت کمتر از کف دوروا", forbidden: "اجازه ندارید", unknown: "خطا" } as R,
  },
  scan: {
    link: "اسکن بارکد و ورود کالا",
    title: "اسکن بارکد و ورود کالا",
    intro: "بارکد یا کد دوبعدی (دیتاماتریکس) روی جعبه را با دوربین گوشی یا بارکدخوان اسکن کنید. نام کالا می‌آید؛ تعداد، شماره سری ساخت و تاریخ انقضا را وارد و ثبت کنید. در کدهای دوبعدی GS1 تاریخ انقضا و سری ساخت خودکار پر می‌شود.",
    camera: "دوربین", stop: "توقف دوربین", manual: "کد را تایپ کنید یا با بارکدخوان بزنید", find: "یافتن",
    noCamera: "دوربین در دسترس نیست یا اجازه داده نشد. کد را دستی وارد کنید یا از بارکدخوان استفاده کنید.",
    looking: "در حال جستجو…", found: "کالا پیدا شد", inStock: "موجودی فعلی: {n}", notInStock: "هنوز در موجودی شما نیست",
    sources: { catalog: "کاتالوگ دوروا", approved: "تأییدشده دوروا", pending: "پیشنهاد شما (در انتظار بررسی)" } as R,
    qty: "تعداد ورودی", batch: "شماره سری ساخت (Batch)", expiry: "تاریخ انقضا", uid: "کد یکتا (UID)",
    receive: "ثبت ورود به موجودی", received: "{n} عدد «{p}» به موجودی اضافه شد.",
    errors: { qty: "تعداد باید ۱ یا بیشتر باشد.", expired: "تاریخ انقضا گذشته است.", product: "کالا پیدا نشد.", forbidden: "اجازه ورود کالا ندارید.", unknown: "خطا؛ دوباره تلاش کنید." } as R,
    unknownCode: "این کد در دوروا شناخته نشده: {c}",
    linkIntro: "کالای این بارکد را پیدا کنید؛ پیوند برای بررسی دوروا فرستاده می‌شود و پس از تأیید برای همه داروخانه‌ها کار می‌کند (و امتیاز همکاری می‌گیرید).",
    searchPh: "نام کالا یا ماده مؤثره", choose: "این کالاست", suggested: "پیشنهاد بارکد برای «{p}» فرستاده شد؛ پس از تأیید دوروا امتیاز می‌گیرید. الان می‌توانید کالا را وارد موجودی کنید.",
    suggestErr: { code: "کد نامعتبر است.", known: "این بارکد قبلاً برای همین کالا ثبت است.", taken: "این بارکد در دوروا برای کالای دیگری ثبت شده است؛ اگر اشتباه است به پشتیبانی بگویید.", product: "کالا پیدا نشد." } as R,
    session: "ورودهای این نوبت", again: "اسکن بعدی",
  },
  contrib: {
    title: "همکاری در کامل کردن اطلاعات دوروا",
    intro: "هر بارکدی که با اسکنر به کالای درست وصل کنید، پس از بررسی دوروا برای همه داروخانه‌ها کار می‌کند.",
    points: "امتیاز شما: {n}", pending: "در انتظار بررسی: {n}", approved: "تأییدشده: {n}", rejected: "ردشده: {n}",
    badge: "نشان «همکار دوروا»", badgeYes: "در صفحه داروخانه نمایش داده می‌شود.", badgeNeed: "با {n} امتیاز دیگر نشان می‌گیرید.",
    priority: "اولویت در تخصیص سفارش: معادل {n} سفارش کمتر در روز (بین داروخانه‌های هم‌فاصله).",
  },
  badge: "همکار دوروا",
  codes: {
    tab: "بارکدهای پیشنهادی",
    title: "بارکدهای پیشنهادی داروخانه‌ها",
    intro: "داروخانه‌ها بارکدهای ناشناس را با اسکنر به کالا وصل می‌کنند. هر پیشنهاد فقط با تأیید شما فعال می‌شود. «موافق» یعنی چند داروخانه همین بارکد را به همین کالا وصل کرده‌اند؛ «تعارض» یعنی همین بارکد به کالای دیگری هم پیشنهاد شده. با تأیید، پیشنهادهای متعارض همان بارکد رد می‌شوند و داروخانه‌های موافق امتیاز می‌گیرند.",
    empty: "پیشنهادی در انتظار نیست.",
    code: "بارکد", product: "کالا", catalogGtin: "بارکد فعلی کاتالوگ", pharmacy: "داروخانه", agree: "موافق", conflicts: "تعارض", when: "زمان",
    approve: "تأیید", reject: "رد", notePh: "دلیل رد (اختیاری)", done: "{n} مورد انجام شد.", selected: "{n} انتخاب‌شده", selectAll: "انتخاب همه",
    export: "خروجی بارکدهای تأییدشده (CSV) برای تیم کاتالوگ",
  },
};
export type ToolTexts = typeof fa;

const en: ToolTexts = {
  excel: {
    title: "Stock via Excel",
    intro: "1) Download the Excel file: every Dorva product with IRC, GTIN barcode, name, active ingredient, category, brand, Dorva price, discount cap and your current stock. 2) Fill or change only the three yellow columns (new stock, your price, discount). 3) Upload it, review the preview, then confirm.",
    download: "Download product Excel file", upload: "Upload filled file", reading: "Reading the file…",
    badFile: "Could not read the file. Upload the .xlsx file you downloaded here.",
    preview: "Preview of changes",
    counts: "{new} new products, {upd} changed rows, {same} unchanged, {err} errors, {price} price changes (waiting for Dorva)",
    kinds: { new: "New", update: "Change", error: "Error" },
    colProduct: "Product", colKind: "Type", colQty: "Stock", colPrice: "Price (Toman)", colDisc: "Discount %", colNote: "Note",
    dorvaPrice: "Dorva price", priceWait: "Price waits for Dorva",
    confirm: "Confirm and save {n} rows", cancel: "Cancel", saving: "Saving…",
    done: "{n} rows saved.", failed: "{n} rows not saved.", nothing: "The file has no changes compared with your stock.",
    e: { value: "Invalid number", discount: "Discount above cap ({n}%)", product: "Product not found in Dorva", price_cap: "Price above Dorva cap", price_floor: "Price below Dorva floor", forbidden: "Not allowed", unknown: "Error" },
  },
  scan: {
    link: "Scan barcodes & receive stock", title: "Scan barcodes & receive stock",
    intro: "Scan the barcode or 2D DataMatrix code on the pack with the phone camera or a barcode reader. The product appears; enter quantity, batch and expiry and save. GS1 2D codes fill expiry and batch automatically.",
    camera: "Camera", stop: "Stop camera", manual: "Type the code or use a barcode reader", find: "Find",
    noCamera: "Camera not available or not allowed. Type the code or use a barcode reader.",
    looking: "Looking up…", found: "Product found", inStock: "Current stock: {n}", notInStock: "Not in your stock yet",
    sources: { catalog: "Dorva catalog", approved: "Approved by Dorva", pending: "Your suggestion (under review)" },
    qty: "Quantity received", batch: "Batch number", expiry: "Expiry date", uid: "Unique code (UID)",
    receive: "Add to stock", received: "{n} × “{p}” added to stock.",
    errors: { qty: "Quantity must be 1 or more.", expired: "Expiry date has passed.", product: "Product not found.", forbidden: "You may not receive stock.", unknown: "Error; try again." },
    unknownCode: "Dorva does not know this code yet: {c}",
    linkIntro: "Find the product for this barcode; the link goes to Dorva for review and, once approved, works for every pharmacy (and earns partner points).",
    searchPh: "Product or active ingredient", choose: "This one", suggested: "Barcode suggested for “{p}”; you earn points once Dorva approves. You can receive the stock now.",
    suggestErr: { code: "Invalid code.", known: "This barcode is already registered for this product.", taken: "Dorva has this barcode for another product; tell support if that is wrong.", product: "Product not found." },
    session: "Received this session", again: "Next scan",
  },
  contrib: {
    title: "Helping complete Dorva's data",
    intro: "Every barcode you link to the right product with the scanner works for all pharmacies once Dorva has checked it.",
    points: "Your points: {n}", pending: "Under review: {n}", approved: "Approved: {n}", rejected: "Rejected: {n}",
    badge: "“Dorva partner” badge", badgeYes: "Shown on your pharmacy page.", badgeNeed: "{n} more points for the badge.",
    priority: "Allocation priority: counts as {n} fewer orders a day (among equally near pharmacies).",
  },
  badge: "Dorva partner",
  codes: {
    tab: "Suggested barcodes", title: "Barcodes suggested by pharmacies",
    intro: "Pharmacies link unknown barcodes to products with the scanner. Each suggestion becomes active only after you approve it. “Agree” = pharmacies linking this barcode to this product; “conflicts” = the same barcode suggested for another product. Approving rejects the conflicting ones and gives the agreeing pharmacies points.",
    empty: "No pending suggestions.",
    code: "Barcode", product: "Product", catalogGtin: "Catalog barcode", pharmacy: "Pharmacy", agree: "Agree", conflicts: "Conflicts", when: "When",
    approve: "Approve", reject: "Reject", notePh: "Reason (optional)", done: "{n} done.", selected: "{n} selected", selectAll: "Select all",
    export: "Export approved barcodes (CSV) for the catalog team",
  },
};

const ALL: Record<Locale, ToolTexts> = { fa, en, ar: en };
export const getToolTexts = (l: Locale) => ALL[l];
