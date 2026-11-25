import type { Locale } from "../config";

// Dorva panel › configuration snapshots (save the current configuration, bring it back in one action).
type R = Record<string, string>;

const fa = {
  tab: "نسخه‌های تنظیمات",
  title: "نسخه‌های تنظیمات (برگرداندن با یک کلیک)",
  intro: "پیش از تست، وضعیت فعلی را با یک نام ذخیره کنید. بعد از تست، با «بازگردانی» همه‌چیز همان‌طور که بود برمی‌گردد. فقط تنظیمات ذخیره و برگردانده می‌شود؛ کاربران، داروخانه‌ها، سفارش‌ها، پرداخت‌ها و اطلاعات کاتالوگ هیچ‌وقت دست نمی‌خورند. هر بازگردانی، اول وضعیت فعلی را هم خودکار ذخیره می‌کند تا اگر اشتباه شد بتوانید برگردید.",
  groups: {
    settings: "تنظیمات و سیاست‌ها (تنظیمات، کمیسیون و سقف تخفیف، قواعد تخفیف، فیلترها، مکمل‌ها، اعلان‌ها، سئو، خدمات، برچسب‌ها)",
    pages: "صفحه‌ها و ظاهر (چینش صفحه‌ها، قالب‌ها، ظاهر داروخانه‌ها، مجموعه‌ها)",
    products: "کالاها در دوروا (انتشار، قیمت، قیمت‌گذاری، سقف خرید، کف قیمت، کمیسیون اختصاصی…)",
    stock: "موجودی و قیمت داروخانه‌ها (و تنظیمات ارسال آن‌ها)",
  } as R,
  groupShort: { settings: "تنظیمات", pages: "صفحه‌ها", products: "کالاها", stock: "موجودی" } as R,
  createTitle: "ذخیره وضعیت فعلی", name: "نام", namePh: "مثلاً تنظیمات قبل از سند ۵", defaultName: "تنظیمات قبل از سند ۵",
  note: "توضیح (اختیاری)", create: "ذخیره کن",
  listTitle: "نسخه‌های ذخیره‌شده", empty: "هنوز نسخه‌ای ذخیره نشده است.",
  auto: "خودکار، پیش از یک بازگردانی", by: "توسط", rows: "ردیف",
  restoreTitle: "بازگردانی", restoreWhat: "چه چیزهایی برگردد", confirmPh: "برای تأیید، نام نسخه را عیناً بنویسید",
  restore: "بازگردانی کن", del: "حذف این نسخه", delConfirm: "حذف شود (برگشت‌پذیر نیست)",
  results: {
    created: "ذخیره شد.", restored: "بازگردانده شد. وضعیت قبل از بازگردانی هم با نام «پیش از بازگردانی…» ذخیره شد.",
    deleted: "حذف شد.", confirm: "نام واردشده با نام نسخه یکی نیست؛ چیزی تغییر نکرد.", groups: "دست‌کم یک بخش را انتخاب کنید.",
    missing: "این نسخه پیدا نشد.", name: "نام را بنویسید.", error: "انجام نشد. متن خطا: ",
  } as R,
};
type Texts = typeof fa;

const en: Texts = {
  tab: "Config snapshots",
  title: "Configuration snapshots (one-click restore)",
  intro: "Before testing, save the current state under a name. After testing, “Restore” brings everything back as it was. Only configuration is saved and restored; users, pharmacies, orders, payments and catalog data are never touched. Every restore first saves the current state too, so a restore can be undone.",
  groups: {
    settings: "Settings & policies (settings, commission and discount caps, discount rules, filters, complements, notifications, SEO, services, badges)",
    pages: "Pages & looks (page layouts, themes, pharmacy looks, collections)",
    products: "Products in Dorva (publishing, price, priced-by, max per order, minimum price, own commission…)",
    stock: "Pharmacy stock and prices (and their shipping settings)",
  },
  groupShort: { settings: "Settings", pages: "Pages", products: "Products", stock: "Stock" },
  createTitle: "Save the current state", name: "Name", namePh: "e.g. Settings before test doc 5", defaultName: "Settings before test doc 5",
  note: "Note (optional)", create: "Save",
  listTitle: "Saved snapshots", empty: "No snapshot yet.",
  auto: "automatic, before a restore", by: "by", rows: "rows",
  restoreTitle: "Restore", restoreWhat: "What to bring back", confirmPh: "Type the snapshot name exactly to confirm",
  restore: "Restore", del: "Delete this snapshot", delConfirm: "Delete (cannot be undone)",
  results: {
    created: "Saved.", restored: "Restored. The state before the restore was saved as “before restore…”.",
    deleted: "Deleted.", confirm: "The name does not match; nothing changed.", groups: "Choose at least one part.",
    missing: "Snapshot not found.", name: "Enter a name.", error: "Failed. Error: ",
  },
};
const ar: Texts = { ...en, tab: "نسخ الإعدادات", title: "نسخ الإعدادات (استعادة بنقرة)" };

const ALL: Record<Locale, Texts> = { fa, en, ar };
export const getSnapshotTexts = (l: Locale) => ALL[l];
