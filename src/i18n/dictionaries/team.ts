import type { Locale } from "../config";

// Staff round 2: access ticks, staff profiles (CV), team on the pharmacy page.
type R = Record<string, string>;
const fa = {
  roleLater: "بعداً تعیین می‌کنم (بدون دسترسی)",
  inviteNoRole: "می‌توانید نقش را خالی بگذارید: شخص بعد از پذیرفتن دعوت هیچ دسترسی ندارد تا شما دسترسی‌هایش را تیک بزنید.",
  access: "دسترسی‌ها",
  accessEdit: "تنظیم دسترسی",
  template: "شروع از قالب",
  templateHint: "انتخاب قالب، تیک‌ها را مطابق آن پر می‌کند؛ بعد هر تیکی را کم یا زیاد کنید.",
  all: "همه",
  none: "هیچ",
  saveAccess: "ذخیره دسترسی",
  custom: "سفارشی",
  noAccess: "بدون دسترسی",
  cannotGrant: "این دسترسی را خودتان ندارید",
  permCount: (n: string) => `${n} دسترسی`,
  profile: "مشخصات و رزومه",
  noProfile: "هنوز مشخصات را پر نکرده است.",
  groups: {
    shop: "صفحه و مشخصات داروخانه", inventory: "موجودی، قیمت و تخفیف", orders: "سفارش‌ها و تأیید فنی", staff: "کارکنان",
    finder: "دارویابی", pharmacies: "داروخانه‌ها", catalog: "کاتالوگ و مجموعه‌ها", money: "مالی و کمیسیون", site: "تنظیمات و ظاهر سایت", other: "سایر",
  } as R,
  perms: {} as R,
  results: {
    ok: "دسترسی ذخیره شد.", perm: "یکی از تیک‌ها را خودتان ندارید و نمی‌توانید بدهید.", higher: "این شخص دسترسی‌هایی دارد که شما ندارید؛ فقط مدیر بالاتر می‌تواند تغییرش دهد.",
    last_manager: "آخرین مدیر نمی‌تواند دسترسی مدیریت کارکنان را از خودش بردارد.", license: "برای «تأیید فنی» شماره پروانه/نظام پزشکی لازم است.",
    role: "این قالب را نمی‌توانید بدهید.",
  } as R,
  // profile form (account)
  myProfile: "پروفایل کاری من",
  myProfileIntro: "این مشخصات را مدیر داروخانه/دوروا می‌بیند. اگر «نمایش در صفحه داروخانه» را بزنید، نام، عکس، تخصص و معرفی شما در تب «درباره داروخانه» هم دیده می‌شود.",
  fullName: "نام و نام خانوادگی",
  photo: "عکس پرسنلی (مربعی، حداقل ۴۰۰×۴۰۰، JPG/PNG/WebP تا ۲ مگابایت)",
  phone: "تلفن همراه",
  education: "تحصیلات",
  educationPh: "مثلاً دکترای داروسازی، دانشگاه تهران، ۱۳۹۵",
  experience: "سابقه کار",
  experiencePh: "داروخانه‌ها یا شرکت‌هایی که کار کرده‌اید، سال‌ها و نقش‌ها",
  expertise: "حوزه تخصص",
  expertiseOpts: { drug: "دارویی", supplement: "مکمل", cosmetic: "آرایشی و بهداشتی", food: "غذایی و رژیمی", equipment: "تجهیزات پزشکی", herbal: "گیاهی", consult: "مشاوره" } as R,
  council: "شماره نظام پزشکی (برای داروساز / مسئول فنی)",
  bio: "معرفی کوتاه",
  isPublic: "نمایش من در صفحه «درباره داروخانه»",
  save: "ذخیره",
  saved: "ذخیره شد.",
  saveFail: "ذخیره نشد؛ مقادیر را بررسی کنید.",
  photoFail: "عکس باید با همین فرم بارگذاری شود.",
  upload: "بارگذاری عکس",
  uploading: "در حال بارگذاری…",
  uploadFail: "بارگذاری نشد (JPG/PNG/WebP تا ۲ مگابایت).",
  team: "تیم داروخانه",
};
export type TeamTexts = typeof fa;

const en: TeamTexts = {
  ...fa,
  roleLater: "Decide later (no access)",
  inviteNoRole: "You may leave the role empty: after accepting, the person has no access until you tick their permissions.",
  access: "Access", accessEdit: "Set access", template: "Start from template",
  templateHint: "Choosing a template fills the ticks; then add or remove any.",
  all: "All", none: "None", saveAccess: "Save access", custom: "Custom", noAccess: "No access",
  cannotGrant: "You do not have this permission", permCount: (n) => `${n} permissions`,
  profile: "Profile & CV", noProfile: "No profile yet.",
  groups: { shop: "Pharmacy page & profile", inventory: "Stock, prices & discounts", orders: "Orders & technical approval", staff: "Staff",
    finder: "Medicine finder", pharmacies: "Pharmacies", catalog: "Catalogue & collections", money: "Finance & commission", site: "Site settings & look", other: "Other" },
  results: { ok: "Access saved.", perm: "You cannot give a permission you do not have.", higher: "This person has permissions you lack; a higher manager must change them.",
    last_manager: "The last manager cannot remove their own staff permission.", license: "Technical approval needs a licence / council number.", role: "You cannot give this template." },
  myProfile: "My work profile",
  myProfileIntro: "Managers of the pharmacy/Dorva see this. If you tick “Show on the pharmacy page”, your name, photo, expertise and bio appear in its About tab.",
  fullName: "Full name", photo: "Photo (square, at least 400×400, JPG/PNG/WebP up to 2 MB)", phone: "Mobile",
  education: "Education", educationPh: "e.g. Pharm.D., University of Tehran, 2016", experience: "Experience",
  experiencePh: "Pharmacies or companies you worked for, years and roles", expertise: "Expertise",
  expertiseOpts: { drug: "Medicines", supplement: "Supplements", cosmetic: "Cosmetics", food: "Food & diet", equipment: "Medical equipment", herbal: "Herbal", consult: "Counselling" },
  council: "Medical council number (pharmacists)", bio: "Short bio", isPublic: "Show me on the pharmacy's About page",
  save: "Save", saved: "Saved.", saveFail: "Not saved; check the values.", photoFail: "Upload the photo with this form.",
  upload: "Upload photo", uploading: "Uploading…", uploadFail: "Upload failed (JPG/PNG/WebP up to 2 MB).", team: "Our team",
};
const ar: TeamTexts = { ...en, myProfile: "ملفي المهني", team: "فريق الصيدلية", save: "حفظ", saved: "تم الحفظ." };
const TEXTS: Record<Locale, TeamTexts> = { fa, en, ar };
export const getTeamTexts = (l: Locale) => TEXTS[l];
