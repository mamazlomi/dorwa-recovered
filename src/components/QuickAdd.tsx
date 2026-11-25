import Link from "next/link";
import { addToCart } from "@/app/[locale]/cart/actions";
import { SubmitButton } from "@/components/SubmitButton";

// One-tap "add to cart" for product cards. Only the product goes into the
// cart; the cart's allocation picks the pharmacy (preferring one that can
// serve the whole basket). Prescription items and items nobody stocks get
// no button: they are decided on the product page.
export function QuickAdd({ productId, locale, back, label, pending, show }: {
  productId: string; locale: string; back: string; label: string; pending: string; show: boolean;
}) {
  if (!show) return null;
  return (
    <form action={addToCart} className="mt-2">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="qty" value="1" />
      <SubmitButton className="btn w-full py-1.5 text-xs" pendingLabel={pending}>{label}</SubmitButton>
    </form>
  );
}

/** Thin bar shown after a quick add, with a link to the cart. */
export function AddedBar({ show, locale, text, cta }: { show: boolean; locale: string; text: string; cta: string }) {
  if (!show) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 p-3 text-sm">
      <span>{text}</span>
      <Link href={`/${locale}/cart`} className="btn py-1.5 text-sm">{cta}</Link>
    </div>
  );
}
