import type { Locale } from "../config";

// Notifications (bell, popups, settings). Plain strings only.
type R = Record<string, string>;
const fa = {
  bell: "اعلان‌ها",
  empty: "اعلانی نیست.",
  markAll: "همه خوانده شد",
  ack: "دیدم",
  open: "باز کردن",
  mute: "بی‌صدا",
  unmute: "صدا روشن",
  soundHint: "برای فعال شدن صدای هشدار، یک‌بار روی صفحه بزنید.",
  enablePush: "فعال کردن اعلان روی این دستگاه",
  pushOn: "اعلان روی این دستگاه فعال است",
  pushDenied: "اجازه اعلان در مرورگر رد شده است؛ از تنظیمات مرورگر/گوشی اجازه دهید.",
  pushUnsupported: "این مرورگر اعلان پشتیبانی نمی‌کند. روی آیفون ابتدا سایت را از Safari به صفحه اصلی اضافه کنید.",
  pushFail: "فعال نشد؛ دوباره تلاش کنید.",
  mobile: {
    title: "شماره موبایل برای پیامک",
    help: "پیامک‌های مهم (مثل ارسال سفارش یا سفارش منتظر تأیید فنی) به این شماره می‌رود.",
    save: "ذخیره", ok: "ذخیره شد.", format: "شماره را به شکل ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.", taken: "این شماره برای حساب دیگری ثبت شده است.", unknown: "ذخیره نشد.",
  } as R,
  admin: {
    tab: "اعلان‌ها و پیامک",
    title: "اعلان‌ها، هشدار و پیامک",
    intro: "هر رویداد فقط به کسانی می‌رسد که دسترسی آن بخش را دارند (مثلاً سفارش جدید فقط به کارکنانی از داروخانه که دسترسی «دیدن سفارش‌ها» دارند). اعلان درون سایت با پنجره و صدای هشدار همیشه هست؛ اعلان روی گوشی/مرورگر برای هر کسی که روی دستگاهش فعال کرده؛ پیامک را برای هر رویداد خودتان روشن یا خاموش می‌کنید.",
    event: "رویداد", audience: "گیرنده", who: "دسترسی لازم", sms: "پیامک", alarm: "هشدار تکرارشونده", active: "فعال", save: "ذخیره",
    audiences: { pharmacy: "کارکنان داروخانه", platform: "کارکنان دوروا", customer: "مشتری / شخص" } as R,
    alarmHelp: "هشدار تکرارشونده: پنجره و صدا تا زدن «دیدم» هر چند ثانیه تکرار می‌شود (برای سفارش و تأیید فنی). خاموش: یک بار صدا.",
    stats: "وضعیت", subs: "دستگاه با اعلان فعال", mobiles: "کاربر با شماره موبایل", lastDay: "اعلان ۲۴ ساعت اخیر",
    smsSent: "پیامک ارسال‌شده (۷ روز)", smsFailed: "پیامک ناموفق یا بدون شماره (۷ روز)", pushSent: "اعلان گوشی ارسال‌شده (۷ روز)", queued: "در صف ارسال",
    keys: "کلیدهای اعلان گوشی", yes: "ساخته شده", no: "هنوز ساخته نشده (با اولین فعال‌سازی ساخته می‌شود)",
    setup: "راه‌اندازی پیامک",
    setupSteps: "۱) در سرویس پیامک (پیش‌فرض کاوه‌نگار) حساب و خط ارسال بگیرید. ۲) در Supabase › Edge Functions › Secrets یک secret به نام SMS_API_KEY با کلید API سرویس بسازید (این کلید را خودتان وارد کنید، نه در گفتگو). ۳) در «تنظیمات › اعلان‌ها» شماره خط را بنویسید. ۴) «ارسال اعلان آزمایشی» را بزنید.",
    test: "ارسال اعلان آزمایشی به خودم",
    testOk: "اعلان آزمایشی فرستاده شد؛ چند ثانیه دیگر پنجره و صدای هشدار را می‌بینید.",
    log: "آخرین اعلان‌ها",
    status: { none: "—", queued: "در صف", sent: "ارسال شد", failed: "ناموفق", no_phone: "بدون شماره", no_provider: "پیامک راه‌اندازی نشده" } as R,
    settings: "تنظیمات اعلان (پیامک، خط ارسال، آستانه موجودی، هشدار تاریخ مصرف)",
    saved: "ذخیره شد.",
  },
};
export type NotifyTexts = typeof fa;
const en: NotifyTexts = {
  bell: "Notifications", empty: "No notifications.", markAll: "Mark all read", ack: "Got it", open: "Open", mute: "Mute", unmute: "Sound on",
  soundHint: "Tap the page once to enable alarm sounds.",
  enablePush: "Enable notifications on this device", pushOn: "Notifications are on for this device",
  pushDenied: "Notifications are blocked in the browser; allow them in browser/phone settings.",
  pushUnsupported: "This browser does not support notifications. On iPhone, first add the site to the Home Screen from Safari.",
  pushFail: "Could not enable; try again.",
  mobile: { title: "Mobile number for SMS", help: "Important SMS (e.g. order shipped, order awaiting technical approval) go to this number.",
    save: "Save", ok: "Saved.", format: "Write it as 09123456789.", taken: "This number belongs to another account.", unknown: "Not saved." },
  admin: {
    ...fa.admin,
    tab: "Notifications & SMS", title: "Notifications, alarms and SMS",
    intro: "Each event reaches only people with access to that area. In-app popups with an alarm sound are always on; device push for anyone who enabled it; SMS per event as you choose.",
    event: "Event", audience: "Recipients", who: "Required access", sms: "SMS", alarm: "Repeating alarm", active: "Active", save: "Save",
    audiences: { pharmacy: "Pharmacy staff", platform: "Dorva staff", customer: "Customer / person" },
    alarmHelp: "Repeating alarm: popup and sound repeat until “Got it” (orders, technical approval). Off: one chime.",
    stats: "Status", subs: "Devices with push", mobiles: "Users with a mobile", lastDay: "Notifications in 24h",
    smsSent: "SMS sent (7 days)", smsFailed: "SMS failed / no number (7 days)", pushSent: "Push sent (7 days)", queued: "Queued",
    keys: "Push keys", yes: "Created", no: "Not yet (created on first activation)",
    setup: "SMS setup",
    setupSteps: "1) Get an account and sender line at the SMS provider (Kavenegar by default). 2) In Supabase › Edge Functions › Secrets create SMS_API_KEY with the provider API key (enter it yourself, not in chat). 3) Set the sender line in Settings › Notifications. 4) Send a test.",
    test: "Send me a test notification", testOk: "Test sent; the popup and alarm appear in a few seconds.", log: "Latest notifications",
    status: { none: "—", queued: "Queued", sent: "Sent", failed: "Failed", no_phone: "No number", no_provider: "SMS not set up" },
    settings: "Notification settings (SMS, sender line, low-stock threshold, expiry alert)", saved: "Saved.",
  },
};
const ALL: Record<Locale, NotifyTexts> = { fa, en, ar: en };
export const getNotifyTexts = (l: Locale) => ALL[l];
