import type { Locale } from "../config";

type Sec = { id: string; title: string; body: string[] };
type AboutTexts = { title: string; intro: string; sections: Sec[]; soon: string };

const fa: AboutTexts = {
  title: "دوروا چطور کار می‌کند",
  intro: "دوروا شبکه‌ای از داروخانه‌های واقعی و دارای پروانه است. شما از دوروا می‌خرید، ولی کالا را یک داروخانه نزدیک شما آماده و ارسال می‌کند.",
  soon: "به‌زودی",
  sections: [
    { id: "nearest", title: "خرید از نزدیک‌ترین داروخانه", body: [
      "بعد از انتخاب آدرس، دوروا داروخانه‌ای را پیشنهاد می‌دهد که همه اقلام سبد شما را دارد و نزدیک است.",
      "اگر چند داروخانه شرایط برابر داشته باشند، سفارش‌ها نوبتی بین آن‌ها تقسیم می‌شود تا رقابت منصفانه بماند." ] },
    { id: "pharmacist", title: "بررسی توسط داروساز", body: [
      "مکمل‌ها و داروهای بدون نسخه پس از پرداخت توسط مسئول فنی همان داروخانه بررسی و تأیید می‌شوند.",
      "اگر مسئول فنی قلمی را تأیید نکند، مبلغ همان قلم به شما برمی‌گردد. اگر مهلت بررسی تمام شود، سفارش به داروخانه دیگری با قیمت برابر یا کمتر می‌رود." ] },
    { id: "escrow", title: "پرداخت امن تا تحویل", body: [
      "پولی که می‌پردازید تا تحویل کالا نزد بانک می‌ماند و به داروخانه نمی‌رسد.",
      "فقط وقتی کد تحویل را به پیک می‌دهید، مبلغ آزاد می‌شود. هر بخشی که لغو یا تأیید نشود، برمی‌گردد." ] },
    { id: "finder", title: "دارویاب داروهای کمیاب", body: [
      "برای داروهای کمیاب، بدون ورود ببینید کدام داروخانه‌ها در شهر شما آن را اعلام کرده‌اند و مستقیم تماس بگیرید." ] },
    { id: "advice", title: "مشاوره داروساز", body: [
      "امکان پرسش از داروساز پیش از خرید در حال آماده‌سازی است." ] },
    { id: "rx", title: "ثبت نسخه", body: [
      "داروهای نسخه‌ای فعلاً فقط برای اطلاع نمایش داده می‌شوند و خرید آنلاین ندارند. ثبت نسخه الکترونیک در حال آماده‌سازی است." ] },
  ],
};
const en: AboutTexts = {
  title: "How Dorva works",
  intro: "Dorva is a network of real, licensed pharmacies. You buy from Dorva; a pharmacy near you prepares and sends the order.",
  soon: "Soon",
  sections: [
    { id: "nearest", title: "Buy from the nearest pharmacy", body: [
      "Once you pick an address, Dorva suggests a nearby pharmacy that has everything in your basket.",
      "When several pharmacies are equally suitable, orders are shared between them in turn to keep it fair." ] },
    { id: "pharmacist", title: "Checked by a pharmacist", body: [
      "Supplements and over-the-counter medicines are checked by that pharmacy's pharmacist after payment.",
      "An item the pharmacist does not approve is refunded. If the check runs out of time, the order moves to another pharmacy at the same or a lower price." ] },
    { id: "escrow", title: "Payment held until delivery", body: [
      "Your payment stays with the bank until delivery; the pharmacy does not receive it before then.",
      "It is released only when you give the courier your delivery code. Anything cancelled or not approved is refunded." ] },
    { id: "finder", title: "Scarce-medicine finder", body: [
      "For hard-to-find medicines, see without signing in which pharmacies in your city have reported them, and call them directly." ] },
    { id: "advice", title: "Pharmacist advice", body: ["Asking a pharmacist before you buy is being prepared."] },
    { id: "rx", title: "Prescriptions", body: [
      "Prescription medicines are shown for information only and cannot be bought online yet. Electronic prescriptions are being prepared." ] },
  ],
};
const ar: AboutTexts = {
  title: "كيف تعمل دوروا",
  intro: "دوروا شبكة من صيدليات حقيقية مرخصة. تشتري من دوروا، وتجهّز صيدلية قريبة منك الطلب وترسله.",
  soon: "قريباً",
  sections: [
    { id: "nearest", title: "الشراء من أقرب صيدلية", body: ["بعد اختيار العنوان تقترح دوروا صيدلية قريبة لديها كل ما في سلتك.", "إذا تساوت عدة صيدليات تُوزّع الطلبات بينها بالتناوب حفاظاً على العدالة."] },
    { id: "pharmacist", title: "مراجعة الصيدلي", body: ["تُراجع المكملات والأدوية دون وصفة من قِبل صيدلي الصيدلية بعد الدفع.", "يُعاد مبلغ أي منتج لا يوافق عليه الصيدلي، وإذا انتهت المهلة يُحوَّل الطلب إلى صيدلية أخرى بسعر مساوٍ أو أقل."] },
    { id: "escrow", title: "دفع آمن حتى التسليم", body: ["يبقى المبلغ لدى البنك حتى التسليم.", "يُحرَّر فقط عند إعطاء رمز التسليم للمندوب، ويُعاد كل ما أُلغي."] },
    { id: "finder", title: "البحث عن الأدوية النادرة", body: ["اعرف دون تسجيل الدخول أي صيدليات مدينتك أعلنت توفر الدواء واتصل بها مباشرة."] },
    { id: "advice", title: "استشارة صيدلي", body: ["خدمة سؤال الصيدلي قبل الشراء قيد الإعداد."] },
    { id: "rx", title: "الوصفات", body: ["الأدوية الموصوفة للعرض فقط حالياً، والوصفة الإلكترونية قيد الإعداد."] },
  ],
};
const TEXTS: Record<Locale, AboutTexts> = { fa, en, ar };
export const getAboutTexts = (l: Locale) => TEXTS[l];
