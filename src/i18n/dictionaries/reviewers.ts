import type { Locale } from "../config";

// Reviewer workflow (claim → decide → credit) and payout records; plus the labels of the Settings tabs.
const fa = {
  staffTitle: "تیم دوروا",
  claimNext: "برداشتن نظر بعدی از صف", claimedTitle: "نظرهای در دست بررسی من", noClaimed: "الان نظری در دست شما نیست؛ از صف یکی بردارید.",
  minLeft: "دقیقه تا پایان مهلت", release: "بازگرداندن به صف", queueSize: "نظر در صف بررسی",
  cap: "سقف بررسی امروز شما پر شده است.", tooMany: "ابتدا نظرهای برداشته‌شده را تمام کنید.", nothing: "الان نظری در صف نیست.", claimFailed: "برداشتن انجام نشد.",
  decideFailed: "ثبت نشد؛ شاید مهلتتان تمام شده یا برای «ثبت توضیح» متن ننوشته‌اید.",
  staffQueue: "صف کامل (دسترسی کارکنان)", claimedBy: "در دست بررسی",
  myStats: "کارکرد و دریافتی من", points: "امتیاز پرداخت‌نشده", accrued: "مبلغ پرداخت‌نشده", paid: "مجموع پرداخت‌شده", today: "بررسی در ۲۴ ساعت اخیر", answersToday: "پاسخ مشاوره در ۲۴ ساعت اخیر", rial: "ریال",
  payInfo: "اطلاعات پرداخت", holder: "نام صاحب حساب", iban: "شماره شبا (IR و ۲۴ رقم)", savePay: "ذخیره", paySaved: "ذخیره شد.", payBad: "شماره شبا یا نام معتبر نیست.",
  payNote: "فقط خودتان و بخش مالی دوروا این اطلاعات را می‌بینند.",
  admin: {
    tab: "متخصصان و پرداخت", title: "متخصصان و پرداخت‌ها",
    intro: "هر بررسی یا پاسخ مشاوره بر اساس تنظیمات یک «اعتبار» می‌سازد. اینجا مانده‌ی هر متخصص را می‌بینید و پرداخت را ثبت می‌کنید.",
    hint: "«ثبت پرداخت» یعنی مبلغ را خودتان واریز کرده‌اید؛ این صفحه فقط ثبت می‌کند و پولی جابه‌جا نمی‌کند.",
    settings: "تنظیم امتیازها، نرخ‌ها و سقف‌ها", expert: "متخصص", reviews: "بررسی", answers: "پاسخ", points: "امتیاز", minutes: "دقیقه", accrued: "پرداخت‌نشده (ریال)", paid: "پرداخت‌شده (ریال)",
    iban: "شبا", yes: "دارد", no: "ندارد", pay: "ثبت پرداخت", note: "یادداشت یا کد پیگیری", none: "متخصصی نیست.",
    history: "آخرین پرداخت‌ها", noHistory: "پرداختی ثبت نشده.", forbidden: "دسترسی ندارید.", canNotPay: "ثبت پرداخت فقط برای دارندگان مجوز «پرداخت به متخصصان» است.",
    failed: "ثبت نشد: مبلغی نیست یا از حداقل پرداخت کمتر است.", done: "پرداخت ثبت شد.", queueLink: "صف بررسی",
  },
  tabs: {
    orders: "سفارش و ارسال", catalog: "کاتالوگ و کالا", pharmacies: "داروخانه‌ها", community: "فروم و متخصصان", comms: "اعلان و سئو", look: "ظاهر", other: "سایر",
  } as Record<string, string>,
  groups: { forum: "فروم و مشاوره", review: "بررسی متخصصان، امتیاز و پرداخت", expert: "صلاحیت و نظارت بر متخصصان", customer: "مشتری", pharmacy: "داروخانه" } as Record<string, string>,
  adminCats: { home: "کارتابل", catalog: "کاتالوگ و قیمت", pharmacies: "داروخانه‌ها", orders: "سفارش و تخفیف", community: "جامعه و متخصصان", site: "سایت و ظاهر", system: "سیستم" } as Record<string, string>,
};
type T = typeof fa;
const en: T = {
  staffTitle: "Dorva team",
  claimNext: "Take the next post from the queue", claimedTitle: "Posts I am reviewing", noClaimed: "You have no post in hand; take one from the queue.",
  minLeft: "minutes left", release: "Return to queue", queueSize: "posts waiting",
  cap: "You reached today's review limit.", tooMany: "Finish the posts you already took first.", nothing: "The queue is empty.", claimFailed: "Could not take a post.",
  decideFailed: "Not saved; your time may have run out, or a note is missing.",
  staffQueue: "Full queue (staff)", claimedBy: "being reviewed",
  myStats: "My work and earnings", points: "Unpaid points", accrued: "Unpaid amount", paid: "Total paid", today: "Reviews in the last 24h", answersToday: "Answers in the last 24h", rial: "rial",
  payInfo: "Payout details", holder: "Account holder", iban: "IBAN (IR + 24 digits)", savePay: "Save", paySaved: "Saved.", payBad: "Invalid IBAN or name.",
  payNote: "Only you and Dorva's finance team can see this.",
  admin: {
    tab: "Specialists & payouts", title: "Specialists & payouts",
    intro: "Every review or consultation answer creates a credit priced by Settings. Here you see each specialist's balance and record payouts.",
    hint: "“Record payout” means you already transferred the money; this page only records it.",
    settings: "Set points, rates and limits", expert: "Specialist", reviews: "Reviews", answers: "Answers", points: "Points", minutes: "Minutes", accrued: "Unpaid (rial)", paid: "Paid (rial)",
    iban: "IBAN", yes: "yes", no: "no", pay: "Record payout", note: "Note or reference", none: "No specialists.",
    history: "Latest payouts", noHistory: "No payouts yet.", forbidden: "No access.", canNotPay: "Recording payouts needs the payout permission.",
    failed: "Not recorded: nothing to pay or below the minimum.", done: "Payout recorded.", queueLink: "Review queue",
  },
  tabs: { orders: "Orders & delivery", catalog: "Catalog", pharmacies: "Pharmacies", community: "Forum & specialists", comms: "Notifications & SEO", look: "Appearance", other: "Other" },
  groups: { forum: "Forum & consultation", review: "Specialist review, points & pay", expert: "Specialist qualification & oversight", customer: "Customers", pharmacy: "Pharmacy" },
  adminCats: { home: "Inbox", catalog: "Catalog & prices", pharmacies: "Pharmacies", orders: "Orders & discounts", community: "Community & specialists", site: "Site & look", system: "System" },
};
const ar: T = {
  staffTitle: "فريق دوروا",
  claimNext: "خذ المشاركة التالية من القائمة", claimedTitle: "مشاركات أراجعها", noClaimed: "لا توجد مشاركة بيدك؛ خذ واحدة من القائمة.",
  minLeft: "دقيقة متبقية", release: "إعادة إلى القائمة", queueSize: "مشاركة بالانتظار",
  cap: "بلغت حد المراجعة اليوم.", tooMany: "أنهِ المشاركات التي أخذتها أولاً.", nothing: "القائمة فارغة.", claimFailed: "تعذر الأخذ.",
  decideFailed: "لم يُحفظ؛ ربما انتهت المهلة أو الملاحظة ناقصة.",
  staffQueue: "القائمة الكاملة (الموظفون)", claimedBy: "قيد المراجعة",
  myStats: "عملي ومستحقاتي", points: "نقاط غير مدفوعة", accrued: "مبلغ غير مدفوع", paid: "مجموع المدفوع", today: "مراجعات آخر 24 ساعة", answersToday: "إجابات آخر 24 ساعة", rial: "ريال",
  payInfo: "بيانات الدفع", holder: "اسم صاحب الحساب", iban: "رقم الشبا (IR + 24 رقماً)", savePay: "حفظ", paySaved: "تم الحفظ.", payBad: "الشبا أو الاسم غير صالح.",
  payNote: "أنت وفريق دوروا المالي فقط يرى ذلك.",
  admin: {
    tab: "المتخصصون والدفع", title: "المتخصصون والمدفوعات",
    intro: "كل مراجعة أو إجابة تنشئ رصيداً حسب الإعدادات. هنا ترى رصيد كل متخصص وتسجل الدفع.",
    hint: "«تسجيل الدفع» يعني أنك حوّلت المبلغ بنفسك؛ هذه الصفحة تسجل فقط.",
    settings: "ضبط النقاط والأسعار والحدود", expert: "المتخصص", reviews: "مراجعات", answers: "إجابات", points: "نقاط", minutes: "دقائق", accrued: "غير مدفوع (ريال)", paid: "مدفوع (ريال)",
    iban: "الشبا", yes: "نعم", no: "لا", pay: "تسجيل الدفع", note: "ملاحظة أو مرجع", none: "لا يوجد متخصصون.",
    history: "آخر المدفوعات", noHistory: "لا مدفوعات.", forbidden: "لا صلاحية.", canNotPay: "تسجيل الدفع يحتاج صلاحية الدفع.",
    failed: "لم يُسجل: لا مبلغ أو أقل من الحد الأدنى.", done: "تم تسجيل الدفع.", queueLink: "قائمة المراجعة",
  },
  tabs: { orders: "الطلبات والتوصيل", catalog: "الكتالوج", pharmacies: "الصيدليات", community: "المنتدى والمتخصصون", comms: "الإشعارات وSEO", look: "المظهر", other: "أخرى" },
  groups: { forum: "المنتدى والاستشارة", review: "مراجعة المتخصصين والنقاط والدفع", expert: "أهلية المتخصصين والمراقبة", customer: "العملاء", pharmacy: "الصيدلية" },
  adminCats: { home: "الوارد", catalog: "الكتالوج والأسعار", pharmacies: "الصيدليات", orders: "الطلبات والخصومات", community: "المجتمع والمتخصصون", site: "الموقع والمظهر", system: "النظام" },
};
const ALL: Record<Locale, T> = { fa, en, ar };
export const getReviewerTexts = (l: Locale) => ALL[l];
