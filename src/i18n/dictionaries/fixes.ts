import type { Locale } from "../config";

// Texts added after test round 2 (stock cap, pharmacy search, other-city switch).
const fa = {
  capped: "به اندازه موجودی به سبد اضافه شد؛ بیشتر از این موجود نیست.",
  inCart: (n: string) => `${n} عدد در سبد شماست`,
  allInCart: "همه موجودی این داروخانه در سبد شماست",
  searchHere: (name: string) => `جستجو فقط در کالاهای ${name}`,
  searchHerePh: "نام کالا یا ماده مؤثره در همین داروخانه",
  notHere: (q: string) => `«${q}» در این داروخانه نیست.`,
  searchSite: (q: string) => `«${q}» را در همه داروخانه‌های دوروا بگردید`,
  otherCityTitle: "این اقلام در شهر شما نیست",
  otherCityBody: (city: string, fee: string, days: string) => `از ${city} قابل ارسال است (هزینه ارسال ${fee}، ${days}). با یک کلیک از همان‌جا بخرید یا کالا را حذف کنید.`,
  otherCityBtn: (city: string) => `خرید از ${city}`,
  didYouMean: (q: string) => `«${q}» دقیقاً پیدا نشد؛ نزدیک‌ترین داروها به آنچه نوشتید:`,
  alertsTitle: "درخواست‌های بیماران برای شما",
  alertsIntro: "این داروها را بیماران در شهر شما (یا در کل کشور) زیاد جستجو کرده‌اند و پیدا نکرده‌اند. اگر دارید «دارم» بزنید تا به بیماران نشان داده شوید.",
  scope: { national: "کمبود کشوری", regional: "کمبود منطقه‌ای" } as Record<string, string>,
  searches: (n: string) => `${n} جستجوی بی‌جواب`,
  have: "دارم", dontHave: "ندارم",
  demandTitle: "تقاضای بی‌جواب (غلط‌های تایپی ادغام شده)",
  demandIntro: "هر جستجوی بی‌جواب یک بار به نزدیک‌ترین کالای کاتالوگ وصل می‌شود؛ وقتی در یک شهر به آستانه برسد، دارو خودکار وارد لیست می‌شود و داروخانه‌های آن شهر اعلان می‌گیرند. آستانه‌ها در «تنظیمات › دارویابی».",
  colProduct: "دارو", colCity: "شهر", colSearches: "جستجو", colSpellings: "نوشته‌های بیماران", colStatus: "وضعیت",
  listed: "در لیست", notListed: "هنوز نه", cities: (n: string) => `${n} شهر`, noDemand: "هنوز جستجوی بی‌جوابی ثبت نشده.",
};
export type FixTexts = typeof fa;

const en: FixTexts = {
  capped: "Added up to the stock; there is no more than this.",
  inCart: (n) => `${n} in your cart`,
  allInCart: "All of this pharmacy's stock is in your cart",
  searchHere: (name) => `Search only ${name}'s products`,
  searchHerePh: "Product or active ingredient in this pharmacy",
  notHere: (q) => `“${q}” is not in this pharmacy.`,
  searchSite: (q) => `Search all Dorva pharmacies for “${q}”`,
  otherCityTitle: "These items are not in your city",
  otherCityBody: (city, fee, days) => `They can be sent from ${city} (shipping ${fee}, ${days}). Buy from there with one click, or remove them.`,
  otherCityBtn: (city) => `Buy from ${city}`,
  didYouMean: (q) => `No exact match for “${q}”; closest medicines:`,
  alertsTitle: "Patients are looking for these",
  alertsIntro: "Patients in your city (or nationwide) searched for these without finding them. If you have one, press “I have it”.",
  scope: { national: "National shortage", regional: "Regional shortage" },
  searches: (n) => `${n} unanswered searches`, have: "I have it", dontHave: "I don't",
  demandTitle: "Unanswered demand (typos merged)",
  demandIntro: "Each unanswered search is matched once to the nearest catalogue product; past the threshold in a city it joins the list and that city's pharmacies are alerted. Thresholds: Settings › Finder.",
  colProduct: "Medicine", colCity: "City", colSearches: "Searches", colSpellings: "What patients typed", colStatus: "Status",
  listed: "Listed", notListed: "Not yet", cities: (n) => `${n} cities`, noDemand: "No unanswered searches yet.",
};

const ar: FixTexts = {
  capped: "أُضيف بقدر المخزون؛ لا يتوفر أكثر من ذلك.",
  inCart: (n) => `${n} في سلتك`,
  allInCart: "كل مخزون هذه الصيدلية في سلتك",
  searchHere: (name) => `البحث في منتجات ${name} فقط`,
  searchHerePh: "اسم المنتج أو المادة الفعالة في هذه الصيدلية",
  notHere: (q) => `«${q}» غير موجود في هذه الصيدلية.`,
  searchSite: (q) => `ابحث عن «${q}» في كل صيدليات دوروا`,
  otherCityTitle: "هذه المنتجات غير متوفرة في مدينتك",
  otherCityBody: (city, fee, days) => `يمكن إرسالها من ${city} (الشحن ${fee}، ${days}). اشترِ من هناك بنقرة أو احذفها.`,
  otherCityBtn: (city) => `الشراء من ${city}`,
  didYouMean: (q) => `لا تطابق دقيق لـ «${q}»؛ أقرب الأدوية:`,
  alertsTitle: "يبحث المرضى عن هذه الأدوية", alertsIntro: "بحث عنها المرضى دون نتيجة. إن توفرت لديك اضغط «متوفر».",
  scope: { national: "نقص وطني", regional: "نقص إقليمي" }, searches: (n) => `${n} بحث دون نتيجة`, have: "متوفر", dontHave: "غير متوفر",
  demandTitle: "طلب دون نتيجة", demandIntro: "", colProduct: "الدواء", colCity: "المدينة", colSearches: "البحث", colSpellings: "ما كتبه المرضى",
  colStatus: "الحالة", listed: "في القائمة", notListed: "ليس بعد", cities: (n) => `${n} مدن`, noDemand: "لا يوجد بعد.",
};

const TEXTS: Record<Locale, FixTexts> = { fa, en, ar };
export const getFixTexts = (l: Locale) => TEXTS[l];
