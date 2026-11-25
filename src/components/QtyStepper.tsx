"use client";

import { useState } from "react";

// − n + control that feeds a hidden form field, for choosing a quantity
// before adding to the cart. Plain buttons (type="button") so they never submit.
export function QtyStepper({ name, locale, max = 99, decLabel, incLabel }: {
  name: string;
  locale: string;
  max?: number;
  decLabel: string;
  incLabel: string;
}) {
  const [qty, setQty] = useState(1);
  const intl = locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-US";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <input type="hidden" name={name} value={qty} />
      <button type="button" className="btn-ghost px-3" aria-label={decLabel}
        disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
      <span className="w-6 text-center" aria-live="polite">{qty.toLocaleString(intl)}</span>
      <button type="button" className="btn-ghost px-3" aria-label={incLabel}
        disabled={qty >= max} onClick={() => setQty((q) => Math.min(max, q + 1))}>+</button>
    </div>
  );
}
