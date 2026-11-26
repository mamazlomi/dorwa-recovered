import type { Locale } from "../config";

// Sign-in with an SMS code.
const fa = {
  title: "ورود با پیامک",
  body: "شماره موبایل را بنویسید؛ یک کد ۵ رقمی برایتان پیامک می‌شود. اگر حساب ندارید، همین‌جا ساخته می‌شود.",
  mobile: "شماره موبایل",
  mobilePh: "۰۹۱۲۳۴۵۶۷۸۹",
  send: "ارسال کد",
  codeSentTo: "کد به این شماره پیامک شد:",
  code: "کد تایید",
  verify: "ورود",
  change: "تغییر شماره",
  resend: "دریافت دوباره کد",
  errors: {
    mobile: "شماره موبایل معتبر نیست. مثل ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.",
    config: "ورود با پیامک هنوز راه‌اندازی نشده است. با رمز عبور یا ایمیل وارد شوید.",
    wait: "کد قبلی تازه فرستاده شده. یک دقیقه صبر کنید و دوباره بزنید.",
    limit: "تعداد درخواست‌ها زیاد بود. حدود یک ساعت بعد دوباره تلاش کنید.",
    sms: "پیامک ارسال نشد. چند دقیقه بعد دوباره تلاش کنید یا با ایمیل وارد شوید.",
    invalid: "کد درست نیست.",
    expired: "کد منقضی شده است. دوباره کد بگیرید.",
    attempts: "تعداد تلاش‌های اشتباه زیاد بود. کد تازه بگیرید.",
    session: "ورود کامل نشد. دوباره تلاش کنید.",
  } as Record<string, string>,
};
type Texts = typeof fa;

const en: Texts = {
  title: "Sign in with SMS",
  body: "Enter your mobile number and we text you a 5-digit code. If you have no account, one is created.",
  mobile: "Mobile number", mobilePh: "09123456789", send: "Send code",
  codeSentTo: "We sent a code to:", code: "Verification code", verify: "Sign in",
  change: "Change number", resend: "Send the code again",
  errors: {
    mobile: "The mobile number is not valid. Use a format like 09123456789.",
    config: "SMS sign-in is not set up yet. Use your password or e-mail.",
    wait: "A code was just sent. Wait a minute and try again.",
    limit: "Too many requests. Try again in about an hour.",
    sms: "The text message could not be sent. Try again in a few minutes or use e-mail.",
    invalid: "The code is not correct.", expired: "The code has expired. Request a new one.",
    attempts: "Too many wrong tries. Request a new code.", session: "Sign-in did not complete. Try again.",
  },
};

const ar: Texts = {
  title: "الدخول برسالة نصية",
  body: "اكتب رقم الجوال وسنرسل لك رمزاً من 5 أرقام. إن لم يكن لديك حساب فسيُنشأ هنا.",
  mobile: "رقم الجوال", mobilePh: "09123456789", send: "إرسال الرمز",
  codeSentTo: "أُرسل الرمز إلى:", code: "رمز التحقق", verify: "دخول",
  change: "تغيير الرقم", resend: "إرسال الرمز مرة أخرى",
  errors: {
    mobile: "رقم الجوال غير صالح. اكتبه مثل 09123456789.",
    config: "الدخول بالرسالة النصية غير مفعّل بعد. ادخل بكلمة المرور أو البريد.",
    wait: "أُرسل رمز للتو. انتظر دقيقة ثم أعد المحاولة.",
    limit: "طلبات كثيرة. حاول بعد ساعة تقريباً.",
    sms: "تعذر إرسال الرسالة. حاول بعد دقائق أو ادخل بالبريد.",
    invalid: "الرمز غير صحيح.", expired: "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
    attempts: "محاولات خاطئة كثيرة. اطلب رمزاً جديداً.", session: "لم يكتمل الدخول. حاول مرة أخرى.",
  },
};

const ALL: Record<Locale, Texts> = { fa, en, ar };
export const getPhoneLoginTexts = (l: Locale) => ALL[l];
