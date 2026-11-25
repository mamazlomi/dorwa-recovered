import type { Locale } from "../config";

// Admin › SEO. Plain strings only.
type R = Record<string, string>;
const fa = {
  tab: "سئو",
  title: "سئو (بهینه‌سازی برای موتورهای جستجو)",
  intro: "نقشه سایت، robots.txt، عنوان و توضیح صفحه‌ها، لینک زبان‌ها (hreflang)، آدرس اصلی (canonical) و داده ساختاریافته (کالا، داروخانه، مسیر صفحه) خودکار ساخته می‌شوند. اینجا عنوان/توضیح صفحه‌های خاص را عوض می‌کنید، آدرس‌های قدیمی را هدایت می‌کنید و ایرادها را می‌بینید.",
  off: "ایندکس خاموش است: موتورهای جستجو سایت را نمی‌بینند (برای دوره پایلوت درست است). هنگام راه‌اندازی در تنظیمات روشنش کنید.",
  on: "ایندکس روشن است: نقشه سایت و robots.txt باز هستند.",
  settings: "تنظیمات سئو (ایندکس، پسوند عنوان، توضیح پیش‌فرض، کد تأیید گوگل و بینگ)",
  links: "بررسی خروجی:",
  report: "گزارش کیفیت",
  rep: {
    products: "کالای منتشرشده", rx: "داروی نسخه‌ای (ایندکس نمی‌شود مگر در تنظیمات)", no_image: "کالای بدون تصویر", no_en: "کالای بدون نام انگلیسی",
    pharmacies: "داروخانه واقعی فعال", virtual: "داروخانه مجازی (ایندکس نمی‌شود)", ph_no_about: "داروخانه بدون متن معرفی",
    ph_short_about: "داروخانه با متن معرفی کوتاه (کمتر از ۱۲۰ حرف)", col_no_desc: "مجموعه دوروا بدون توضیح",
  } as R,
  samplesImage: "نمونه کالاهای بدون تصویر (از کاتالوگ‌سازی اصلاح شود):",
  samplesAbout: "داروخانه‌های بدون معرفی کافی:",
  pages: "عنوان و توضیح اختصاصی صفحه‌ها",
  pagesHelp: "آدرس بدون زبان: / برای صفحه اول، /products، /pharmacies، نام صفحه داروخانه مثل /drmazloomi، یا /product/شناسه. خالی = متن خودکار. عنوان ۳۰ تا ۶۰ و توضیح ۱۲۰ تا ۱۶۰ حرف بهتر است.",
  path: "آدرس", titleFa: "عنوان فارسی", titleEn: "عنوان انگلیسی", titleAr: "عنوان عربی", descFa: "توضیح فارسی", descEn: "توضیح انگلیسی", descAr: "توضیح عربی",
  noindex: "ایندکس نشود", ogImage: "تصویر اشتراک‌گذاری (https://…)", save: "ذخیره", del: "حذف", add: "افزودن",
  redirects: "هدایت آدرس‌ها (ریدایرکت)",
  redirectsHelp: "برای آدرس‌های قدیمی یا تغییرنام‌یافته، تا لینک‌ها و رتبه گوگل از دست نرود. دائمی (۳۰۸) برای تغییر همیشگی، موقت (۳۰۷) برای مدت کوتاه. تا ۵ دقیقه طول می‌کشد اعمال شود.",
  from: "از آدرس", to: "به آدرس", permanent: "دائمی", active: "فعال", note: "یادداشت",
  chars: "{n} حرف",
  results: { ok: "ذخیره شد.", path: "آدرس نامعتبر است (فقط حروف انگلیسی کوچک، عدد و - _ /؛ آدرس‌های پنل مجاز نیست).", loop: "این هدایت حلقه می‌سازد.", value: "یکی از مقادیر نامعتبر است.", forbidden: "اجازه ندارید.", unknown: "خطا؛ دوباره تلاش کنید." } as R,
};
export type SeoTexts = typeof fa;
const en: SeoTexts = {
  ...fa,
  tab: "SEO", title: "SEO",
  intro: "Sitemap, robots.txt, page titles and descriptions, hreflang, canonical links and structured data (product, pharmacy, breadcrumb) are generated automatically. Here you override titles/descriptions, redirect old addresses and see issues.",
  off: "Indexing is off: search engines do not see the site (right for the pilot). Switch it on in settings at launch.",
  on: "Indexing is on: sitemap and robots.txt are open.",
  settings: "SEO settings (indexing, title suffix, default description, Google/Bing verification)", links: "Check output:", report: "Quality report",
  rep: { products: "Published products", rx: "Prescription medicines (not indexed unless enabled)", no_image: "Products without image", no_en: "Products without English name",
    pharmacies: "Active real pharmacies", virtual: "Virtual pharmacies (not indexed)", ph_no_about: "Pharmacies without about text",
    ph_short_about: "Pharmacies with a short about text (<120 chars)", col_no_desc: "Dorva collections without description" },
  samplesImage: "Products without an image (fix in the cataloging system):", samplesAbout: "Pharmacies without enough about text:",
  pages: "Page titles and descriptions", pagesHelp: "Path without language: / for home, /products, /pharmacies, a pharmacy page like /drmazloomi, or /product/<id>. Empty = automatic text. Titles 30–60 and descriptions 120–160 characters work best.",
  path: "Path", titleFa: "Persian title", titleEn: "English title", titleAr: "Arabic title", descFa: "Persian description", descEn: "English description", descAr: "Arabic description",
  noindex: "Do not index", ogImage: "Share image (https://…)", save: "Save", del: "Delete", add: "Add",
  redirects: "Redirects", redirectsHelp: "For old or renamed addresses, so links and Google ranking are kept. Permanent (308) or temporary (307). Takes up to 5 minutes.",
  from: "From", to: "To", permanent: "Permanent", active: "Active", note: "Note", chars: "{n} chars",
  results: { ok: "Saved.", path: "Invalid path (lowercase letters, digits, - _ /; panel paths not allowed).", loop: "This redirect makes a loop.", value: "A value is invalid.", forbidden: "Not allowed.", unknown: "Error; try again." },
};
const ALL: Record<Locale, SeoTexts> = { fa, en, ar: en };
export const getSeoTexts = (l: Locale) => ALL[l];
