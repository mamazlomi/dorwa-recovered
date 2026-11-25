import type { Locale } from "../config";

// Customer cancellation, technical-officer deadline and split-shipping texts.
const fa = {
  cancelPart: "لغو این بخش",
  cancelOrder: "لغو کل سفارش",
  cancelConfirm: "مبلغ کالا و ارسال این بخش به شما برمی‌گردد.",
  cancelResult: { cancelled: "لغو شد و مبلغ برگشت داده شد.", not_allowed: "این سفارش دیگر قابل لغو نیست." } as Record<string, string>,
  reason: {
    customer: "لغو توسط شما",
    tech_rejected: "رد توسط مسئول فنی",
    tech_timeout: "مسئول فنی در مهلت پاسخ نداد",
  } as Record<string, string>,
  deskReason: {
    customer: "لغو توسط مشتری",
    tech_rejected: "رد توسط مسئول فنی",
    tech_timeout: "پایان مهلت مسئول فنی",
  } as Record<string, string>,
  deadline: (t: string) => `مهلت تأیید فنی تا ${t}`,
  deadlinePassed: "مهلت تأیید فنی تمام شده است؛ سفارش به‌زودی به داروخانه دیگری ارجاع یا لغو می‌شود.",
  customerDeadline: (t: string) => `اگر مسئول فنی تا ${t} پاسخ ندهد، سفارش به داروخانه دیگری با همان قیمت یا ارزان‌تر ارجاع یا لغو و مبلغ برگشت داده می‌شود.`,
  reassigned: (n: string) => `${n} بار به داروخانه دیگری ارجاع شده است.`,
  splitDiscount: "تخفیف ارسال سفارش چند داروخانه‌ای",
};
type Texts = typeof fa;

const en: Texts = {
  cancelPart: "Cancel this part",
  cancelOrder: "Cancel the whole order",
  cancelConfirm: "Items and shipping of this part are refunded to you.",
  cancelResult: { cancelled: "Cancelled and refunded.", not_allowed: "This order can no longer be cancelled." },
  reason: { customer: "Cancelled by you", tech_rejected: "Rejected by the technical officer", tech_timeout: "The technical officer did not answer in time" },
  deskReason: { customer: "Cancelled by the customer", tech_rejected: "Rejected by the technical officer", tech_timeout: "Technical deadline passed" },
  deadline: (t: string) => `Technical approval due by ${t}`,
  deadlinePassed: "The technical deadline has passed; the order will soon be reassigned or cancelled.",
  customerDeadline: (t: string) => `If the technical officer does not answer by ${t}, the order goes to another pharmacy at the same or a lower price, or is cancelled and refunded.`,
  reassigned: (n: string) => `Reassigned to another pharmacy ${n} time(s).`,
  splitDiscount: "Multi-pharmacy shipping discount",
};

const ar: Texts = {
  cancelPart: "إلغاء هذا الجزء",
  cancelOrder: "إلغاء الطلب كاملاً",
  cancelConfirm: "تُعاد إليك قيمة الأصناف والشحن لهذا الجزء.",
  cancelResult: { cancelled: "أُلغي وأُعيد المبلغ.", not_allowed: "لم يعد هذا الطلب قابلاً للإلغاء." },
  reason: { customer: "ألغيته أنت", tech_rejected: "رفضه المسؤول الفني", tech_timeout: "لم يرد المسؤول الفني في الوقت المحدد" },
  deskReason: { customer: "ألغاه العميل", tech_rejected: "رفضه المسؤول الفني", tech_timeout: "انتهت مهلة المسؤول الفني" },
  deadline: (t: string) => `الموافقة الفنية حتى ${t}`,
  deadlinePassed: "انتهت المهلة الفنية؛ سيُحال الطلب أو يُلغى قريباً.",
  customerDeadline: (t: string) => `إن لم يرد المسؤول الفني حتى ${t} يُحال الطلب إلى صيدلية أخرى بالسعر نفسه أو أقل، أو يُلغى ويُعاد المبلغ.`,
  reassigned: (n: string) => `أُحيل إلى صيدلية أخرى ${n} مرة.`,
  splitDiscount: "خصم شحن الطلب متعدد الصيدليات",
};

const TEXTS: Record<Locale, Texts> = { fa, en, ar };
export function getOrderRuleTexts(locale: Locale): Texts {
  return TEXTS[locale];
}
