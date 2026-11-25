import type { Locale } from "../config";

// Round 6: approval inbox and reminders, content policy, officer accounts.
// Plain strings only: safe to pass to client components.
type R = Record<string, string>;

const fa = {
  inbox: {
    tab: "کارتابل تأیید",
    title: "کارتابل تأیید دوروا",
    intro: "هر چیزی که داروخانه‌ها می‌خواهند روی سایت منتشر کنند و منتظر تأیید شماست. تا تأیید، نسخه قبلی روی سایت می‌ماند. سیاست هر نوع محتوا (آزاد / نیاز به تأیید / قفل) در «تنظیمات › سیاست انتشار محتوای داروخانه‌ها» است.",
    empty: "چیزی منتظر تأیید نیست.",
    waiting: "{n} مورد منتظر تأیید",
    bell: "{n} مورد منتظر تأیید دوروا",
    open: "باز کردن",
    policy: "تنظیم سیاست‌ها",
    kinds: {
      pharmacies: "ثبت‌نام داروخانه‌ها", profiles: "تغییر پروفایل داروخانه‌ها", officers: "پرونده مسئولان فنی",
      pages: "چیدمان صفحه داروخانه‌ها", looks: "ظاهر داروخانه‌ها", collections: "مجموعه‌های داروخانه‌ها",
      prices: "درخواست تغییر قیمت", codes: "بارکدهای پیشنهادی",
    } as R,
    submitted: "ارسال:",
    approve: "تأیید و انتشار",
    reject: "رد با دلیل",
    reasonPh: "دلیل رد (داروخانه می‌بیند؛ حداقل ۵ حرف)",
    changes: "تغییرات",
    before: "فعلی روی سایت",
    after: "پیشنهادی",
    noDiff: "تغییری در متن‌ها دیده نمی‌شود (احتمالاً فقط ترتیب یا جزئیات فنی).",
    newOfficer: "مسئول فنی جدید",
    removedOfficer: "حذف مسئول فنی",
    photo: "عکس",
    fields: {
      phone: "تلفن", address: "آدرس", location: "موقعیت روی نقشه", founder_name: "مؤسس", about_fa: "متن معرفی (فارسی)",
      about_en: "متن معرفی (انگلیسی)", about_ar: "متن معرفی (عربی)", hours: "ساعات کار", kind_codes: "نوع داروخانه",
      services: "خدمات دیگر", service_codes: "خدمات", insurers: "بیمه‌ها", full_name: "نام", council_no: "نظام پزشکی", bio: "معرفی",
      profile: "پرونده حرفه‌ای", resume: "رزومه", shifts: "شیفت‌ها", invite_email: "ایمیل دعوت",
    } as R,
    collection: "مجموعه", rulesInfo: "{r} قاعده، {i} کالای دستی",
    results: { ok: "انجام شد.", note: "برای رد، دلیل بنویسید (حداقل ۵ حرف).", not_pending: "این مورد دیگر منتظر تأیید نیست.", forbidden: "اجازه ندارید.", unknown: "خطا؛ دوباره تلاش کنید." } as R,
  },
  profile: {
    pending: "تغییرات شما برای تأیید دوروا فرستاده شد. تا تأیید، نسخه قبلی روی سایت می‌ماند.",
    pendingBanner: "نسخه‌ای که می‌بینید منتظر تأیید دوروا است (ارسال: {t}). می‌توانید باز هم اصلاح و دوباره ذخیره کنید.",
    rejectedBanner: "دوروا آخرین تغییرات شما را رد کرد. دلیل: {n}. اصلاح کنید و دوباره ذخیره کنید.",
    cancel: "انصراف از تغییرات منتظر و برگشت به نسخه روی سایت",
    locked: "دوروا ویرایش پروفایل داروخانه‌ها را فعلاً قفل کرده است.",
    reviewHint: "هر تغییر (متن، عکس، خدمات، ساعات…) پس از تأیید دوروا روی سایت می‌آید.",
  },
  officerInvite: {
    email: "ایمیل مسئول فنی (برای دعوت به ویرایش پرونده خودش)",
    emailHelp: "با همین ایمیل وارد دوروا شود؛ دعوت را در «حساب من» می‌بیند و بعد از پذیرش، خودش پرونده‌اش را ویرایش می‌کند. پاک کردن یا عوض کردن ایمیل، اتصال حساب را قطع می‌کند.",
    linked: "حساب متصل است",
    invited: "دعوت فرستاده شد؛ منتظر پذیرش",
  },
  me: {
    invitesTitle: "دعوت به عنوان مسئول فنی",
    invite: "داروخانه «{p}» شما را به عنوان مسئول فنی «{n}» معرفی کرده است.",
    accept: "پذیرش", decline: "رد",
    link: "پرونده حرفه‌ای من (مسئول فنی)",
    title: "پرونده حرفه‌ای من",
    intro: "این اطلاعات زیر نام شما در صفحه «درباره داروخانه» همه داروخانه‌هایی که مسئول فنی آن‌ها هستید نمایش داده می‌شود و پس از تأیید دوروا منتشر می‌شود.",
    pharmacies: "داروخانه‌های شما:",
    save: "ذخیره و ارسال برای تأیید",
    results: {
      ok: "ذخیره و منتشر شد.", pending: "برای تأیید دوروا فرستاده شد.", locked: "دوروا ویرایش پرونده‌ها را فعلاً قفل کرده است.",
      none: "حسابی به هیچ داروخانه‌ای متصل نیست.", value: "نام لازم است یا مقداری بیش از حد مجاز است.", file: "عکس یا رزومه باید با همین صفحه بارگذاری شود.",
      unknown: "خطا؛ دوباره تلاش کنید.",
    } as R,
    notLinked: "هنوز هیچ داروخانه‌ای شما را به عنوان مسئول فنی دعوت نکرده است.",
  },
};
export type Round6Texts = typeof fa;

const en: Round6Texts = {
  inbox: {
    tab: "Approval inbox", title: "Dorva approval inbox",
    intro: "Everything pharmacies want to publish that waits for you. The previous version stays live until you approve. Set the policy per content type (free / needs approval / locked) in Settings.",
    empty: "Nothing is waiting.", waiting: "{n} waiting", bell: "{n} items await Dorva approval", open: "Open", policy: "Policies",
    kinds: { pharmacies: "Pharmacy sign-ups", profiles: "Pharmacy profile changes", officers: "Technical officer profiles", pages: "Pharmacy page layouts",
      looks: "Pharmacy looks", collections: "Pharmacy collections", prices: "Price change requests", codes: "Suggested barcodes" },
    submitted: "Sent:", approve: "Approve & publish", reject: "Reject with reason", reasonPh: "Reason (the pharmacy sees it; at least 5 characters)",
    changes: "Changes", before: "Live now", after: "Proposed", noDiff: "No visible text change (probably only order or technical details).",
    newOfficer: "New technical officer", removedOfficer: "Removed technical officer", photo: "Photo",
    fields: { phone: "Phone", address: "Address", location: "Map location", founder_name: "Founder", about_fa: "About (Persian)", about_en: "About (English)",
      about_ar: "About (Arabic)", hours: "Hours", kind_codes: "Pharmacy type", services: "Other services", service_codes: "Services", insurers: "Insurers",
      full_name: "Name", council_no: "Council no.", bio: "Bio", profile: "Professional profile", resume: "Resume", shifts: "Shifts", invite_email: "Invite e-mail" },
    collection: "Collection", rulesInfo: "{r} rules, {i} hand-picked products",
    results: { ok: "Done.", note: "Write a reason to reject (at least 5 characters).", not_pending: "No longer waiting.", forbidden: "Not allowed.", unknown: "Error; try again." },
  },
  profile: {
    pending: "Your changes were sent for Dorva approval. The previous version stays live until then.",
    pendingBanner: "What you see is waiting for Dorva approval (sent {t}). You can still edit and save again.",
    rejectedBanner: "Dorva rejected your last changes. Reason: {n}. Correct and save again.",
    cancel: "Discard the waiting changes and go back to the live version",
    locked: "Dorva has locked pharmacy profiles for now.",
    reviewHint: "Every change (text, photos, services, hours…) goes live after Dorva approves it.",
  },
  officerInvite: {
    email: "Technical officer's e-mail (to let them edit their own profile)",
    emailHelp: "They sign in to Dorva with this e-mail, see the invite under “My account” and then edit their profile themselves. Clearing or changing the e-mail unlinks the account.",
    linked: "Account linked", invited: "Invited; waiting for acceptance",
  },
  me: {
    invitesTitle: "Invitations as technical officer", invite: "“{p}” listed you as its technical officer “{n}”.", accept: "Accept", decline: "Decline",
    link: "My professional profile (technical officer)", title: "My professional profile",
    intro: "Shown under your name on the About page of every pharmacy you work for, after Dorva approves it.",
    pharmacies: "Your pharmacies:", save: "Save and send for approval",
    results: { ok: "Saved and published.", pending: "Sent for Dorva approval.", locked: "Dorva has locked profiles for now.", none: "Your account is not linked to a pharmacy.",
      value: "A name is required or a value is too long.", file: "Upload photos and resumes on this page.", unknown: "Error; try again." },
    notLinked: "No pharmacy has invited you as its technical officer yet.",
  },
};
const ar: Round6Texts = { ...en };

const ALL: Record<Locale, Round6Texts> = { fa, en, ar };
export const getRound6Texts = (l: Locale) => ALL[l];
