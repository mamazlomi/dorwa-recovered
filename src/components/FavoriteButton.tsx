"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFavorite } from "@/app/[locale]/product/[id]/favorite";

// Heart toggle that changes at once and saves in the background (no reload).
// Guests are sent to sign in and come back to the product.
export function FavoriteButton({ productId, initial, signedIn, loginHref, labels }: {
  productId: string; initial: boolean; signedIn: boolean; loginHref: string;
  labels: { add: string; remove: string; login: string };
}) {
  const [on, setOn] = useState(initial);
  const [, start] = useTransition();
  const router = useRouter();
  const label = !signedIn ? labels.login : on ? labels.remove : labels.add;
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={on}
      onClick={() => {
        if (!signedIn) { router.push(loginHref); return; }
        const next = !on;
        setOn(next);
        start(async () => {
          const r = await setFavorite(productId, next);
          if (r === "login") router.push(loginHref);
          else if (r === "error") setOn(!next);
        });
      }}
      className={`rounded-full border border-line px-3 py-1 text-lg leading-none transition hover:border-red-400 ${on ? "text-red-600" : "text-muted"}`}>
      {on ? "♥" : "♡"}
    </button>
  );
}
