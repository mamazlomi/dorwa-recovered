import type { Locale } from "../config";

// Pharmacy panel: stock table, Dorva discount caps, filters.
const fa = {
  filters: "فیلتر",
  search: "جستجوی نام کالا",
  allClasses: "همه انواع",
  allCategories: "همه دسته‌ها",
  allBrands: "همه برندها",
  apply: "اعمال",
  clear: "پاک کردن",
  statuses: {
    all: "همه",
    clipped: "بالاتر از سقف دوروا",
    at_cap: "برابر سقف",
    below: "زیر سقف",
    none: "بدون تخفیف",
    out: "ناموجود",
  } as Record<string, string>,
  statusHelp: {
    clipped: "تخفیف شما از سقف دوروا بیشتر است؛ مشتری فقط تا سقف را می‌بیند.",
    below: "هنوز جا دارید تخفیف بیشتری بدهید.",
  } as Record<string, string>,
  myDiscount: "تخفیف شما",
  cap: "سقف دوروا",
  customerSees: "مشتری می‌بیند",
  status: "وضعیت",
  edit: "ویرایش",
  capSource: { product: "قانون همین کالا", facet: "قانون برند/ویژگی", category: "قانون دسته", class: "سقف نوع کالا" } as Record<string, string>,
  clippedNote: (own: string, cap: string) => `تخفیف شما ${own}٪ است، ولی سقف دوروا ${cap}٪ است؛ مشتری ${cap}٪ می‌بیند.`,
  capForProduct: (cap: string, source: string) => `سقف تخفیف دوروا برای این کالا: ${cap}٪ (${source}).`,
  discountError: (cap: string) => `سقف تخفیف دوروا برای این کالا ${cap}٪ است.`,
  shown: (n: string, total: string) => `${n} از ${total} قلم`,
  noRows: "کالایی با این فیلتر نیست.",
};

type Texts = typeof fa;

const en: Texts = {
  filters: "Filter",
  search: "Search product name",
  allClasses: "All types",
  allCategories: "All categories",
  allBrands: "All brands",
  apply: "Apply",
  clear: "Clear",
  statuses: { all: "All", clipped: "Above Dorva cap", at_cap: "At cap", below: "Below cap", none: "No discount", out: "Out of stock" },
  statusHelp: {
    clipped: "Your discount is above Dorva's cap; customers only see the cap.",
    below: "You still have room to give a bigger discount.",
  },
  myDiscount: "Your discount",
  cap: "Dorva cap",
  customerSees: "Customer sees",
  status: "Status",
  edit: "Edit",
  capSource: { product: "rule for this product", facet: "brand/facet rule", category: "category rule", class: "product-type cap" },
  clippedNote: (own, cap) => `Your discount is ${own}%, but Dorva's cap is ${cap}%; customers see ${cap}%.`,
  capForProduct: (cap, source) => `Dorva discount cap for this product: ${cap}% (${source}).`,
  discountError: (cap) => `Dorva's discount cap for this product is ${cap}%.`,
  shown: (n, total) => `${n} of ${total} items`,
  noRows: "No products match this filter.",
};

const ar: Texts = {
  filters: "تصفية",
  search: "ابحث عن اسم المنتج",
  allClasses: "كل الأنواع",
  allCategories: "كل الفئات",
  allBrands: "كل العلامات",
  apply: "تطبيق",
  clear: "مسح",
  statuses: { all: "الكل", clipped: "أعلى من سقف دوروا", at_cap: "عند السقف", below: "تحت السقف", none: "بلا خصم", out: "غير متوفر" },
  statusHelp: {
    clipped: "خصمك أعلى من سقف دوروا؛ يرى العميل السقف فقط.",
    below: "ما زال لديك مجال لخصم أكبر.",
  },
  myDiscount: "خصمك",
  cap: "سقف دوروا",
  customerSees: "يراه العميل",
  status: "الحالة",
  edit: "تعديل",
  capSource: { product: "قاعدة هذا المنتج", facet: "قاعدة العلامة/السمة", category: "قاعدة الفئة", class: "سقف نوع المنتج" },
  clippedNote: (own, cap) => `خصمك ${own}٪، لكن سقف دوروا ${cap}٪؛ يرى العميل ${cap}٪.`,
  capForProduct: (cap, source) => `سقف خصم دوروا لهذا المنتج: ${cap}٪ (${source}).`,
  discountError: (cap) => `سقف خصم دوروا لهذا المنتج ${cap}٪.`,
  shown: (n, total) => `${n} من ${total} صنف`,
  noRows: "لا منتجات تطابق هذا التصفية.",
};

const TEXTS: Record<Locale, Texts> = { fa, en, ar };
export function getPanelTexts(locale: Locale): Texts {
  return TEXTS[locale];
}
