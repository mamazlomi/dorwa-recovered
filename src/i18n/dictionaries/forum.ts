import type { Locale } from "../config";

// Open health forum: everyone talks, specialists review afterwards.
const fa = {
  nav: "فروم", title: "فروم سلامت",
  intro: "اینجا هر کسی می‌تواند درباره‌ی هر موضوع سلامت گفتگو کند و تجربه‌اش را بنویسد. نظرها بعداً توسط متخصص بررسی می‌شوند: یا تایید می‌شوند یا توضیح تکمیلی می‌گیرند.",
  disclaimer: "تجربه‌ی دیگران نسخه‌ی درمان نیست. پیش از مصرف یا قطع هر دارو با پزشک یا داروساز مشورت کنید.",
  consultLink: "پرسش دقیق دارید؟ از مشاوران بپرسید", newThread: "گفتگوی تازه", threadTitle: "عنوان", threadBody: "متن",
  category: "موضوع", categories: { general: "عمومی", drug: "دارو", pregnancy: "بارداری و شیردهی", child: "کودکان", skin: "پوست و مو", supplement: "مکمل", elderly: "سالمندان", nutrition: "تغذیه", mental: "سلامت روان", other: "سایر" } as Record<string, string>,
  post: "ثبت گفتگو", loginToPost: "برای مشارکت وارد شوید", all: "همه موضوع‌ها", filter: "فیلتر",
  empty: "هنوز گفتگویی نیست. اولین نفر باشید.", comments: "نظر", back: "بازگشت به فروم",
  commentsTitle: "نظرها", noComments: "هنوز نظری نیست.", yourComment: "نظر شما", sendComment: "ثبت نظر",
  review: { pending: "در انتظار بررسی متخصص", verified: "تایید متخصص", corrected: "توضیح متخصص", not_needed: "" } as Record<string, string>,
  expertBadge: "متخصص", reviewedBy: "بررسی‌شده توسط",
  failed: "انجام نشد؛ ورودی‌ها را بررسی کنید.", limit: "سقف ارسال امروز پر شده است.",
  admin: {
    tab: "فروم", queue: "صف بررسی", queueNote: "نظرهای بررسی‌نشده، قدیمی‌ترین اول",
    verify: "تایید", notNeeded: "نیاز به بررسی ندارد", correct: "ثبت توضیح", note: "توضیح متخصص (برای «ثبت توضیح» لازم است)",
    hide: "مخفی", show: "نمایش", empty: "صف خالی است.", thread: "در گفتگوی", forbidden: "دسترسی ندارید.", reviewing: "بررسی", recent: "اخیراً بررسی‌شده", reopen: "بازگشت به صف",
  },
};
type T = typeof fa;
const en: T = {
  nav: "Forum", title: "Health forum",
  intro: "Anyone can discuss any health topic and share experience here. A specialist reviews posts afterwards: they are either confirmed or get a clarifying note.",
  disclaimer: "Other people's experience is not a prescription. Talk to a doctor or pharmacist before taking or stopping any medicine.",
  consultLink: "Have a precise question? Ask the consultants", newThread: "New discussion", threadTitle: "Title", threadBody: "Text",
  category: "Topic", categories: { general: "General", drug: "Medicines", pregnancy: "Pregnancy & breastfeeding", child: "Children", skin: "Skin & hair", supplement: "Supplements", elderly: "Elderly", nutrition: "Nutrition", mental: "Mental health", other: "Other" },
  post: "Post", loginToPost: "Sign in to take part", all: "All topics", filter: "Filter",
  empty: "No discussions yet. Be the first.", comments: "comments", back: "Back to the forum",
  commentsTitle: "Comments", noComments: "No comments yet.", yourComment: "Your comment", sendComment: "Post comment",
  review: { pending: "Awaiting specialist review", verified: "Specialist verified", corrected: "Specialist note", not_needed: "" },
  expertBadge: "Specialist", reviewedBy: "Reviewed by",
  failed: "It did not work; check the fields.", limit: "Today's posting limit is reached.",
  admin: {
    tab: "Forum", queue: "Review queue", queueNote: "Unreviewed posts, oldest first",
    verify: "Verify", notNeeded: "No review needed", correct: "Add note", note: "Specialist note (required for “Add note”)",
    hide: "Hide", show: "Show", empty: "Queue is empty.", thread: "In thread", forbidden: "No access.", reviewing: "Review", recent: "Recently reviewed", reopen: "Back to queue",
  },
};
const ar: T = {
  nav: "المنتدى", title: "منتدى الصحة",
  intro: "يمكن لأي شخص هنا مناقشة أي موضوع صحي ومشاركة تجربته. يراجع المتخصص المشاركات لاحقاً: إما تُعتمد أو تُضاف إليها ملاحظة توضيحية.",
  disclaimer: "تجارب الآخرين ليست وصفة علاجية. استشر الطبيب أو الصيدلي قبل تناول أو إيقاف أي دواء.",
  consultLink: "لديك سؤال دقيق؟ اسأل المستشارين", newThread: "نقاش جديد", threadTitle: "العنوان", threadBody: "النص",
  category: "الموضوع", categories: { general: "عام", drug: "الأدوية", pregnancy: "الحمل والرضاعة", child: "الأطفال", skin: "البشرة والشعر", supplement: "المكملات", elderly: "كبار السن", nutrition: "التغذية", mental: "الصحة النفسية", other: "أخرى" },
  post: "نشر", loginToPost: "سجّل الدخول للمشاركة", all: "كل المواضيع", filter: "تصفية",
  empty: "لا توجد نقاشات بعد. كن الأول.", comments: "تعليقات", back: "العودة إلى المنتدى",
  commentsTitle: "التعليقات", noComments: "لا توجد تعليقات.", yourComment: "تعليقك", sendComment: "إرسال التعليق",
  review: { pending: "بانتظار مراجعة المتخصص", verified: "موثّق من متخصص", corrected: "ملاحظة المتخصص", not_needed: "" },
  expertBadge: "متخصص", reviewedBy: "راجعه",
  failed: "لم تتم العملية؛ تحقق من الحقول.", limit: "بلغت حد النشر اليوم.",
  admin: {
    tab: "المنتدى", queue: "قائمة المراجعة", queueNote: "مشاركات غير مراجعة، الأقدم أولاً",
    verify: "توثيق", notNeeded: "لا تحتاج مراجعة", correct: "إضافة ملاحظة", note: "ملاحظة المتخصص (مطلوبة)",
    hide: "إخفاء", show: "إظهار", empty: "القائمة فارغة.", thread: "في نقاش", forbidden: "لا صلاحية.", reviewing: "مراجعة", recent: "تمت مراجعتها مؤخراً", reopen: "إعادة إلى القائمة",
  },
};
const ALL: Record<Locale, T> = { fa, en, ar };
export const getForumTexts = (l: Locale) => ALL[l];
