"use client";

import { useParams } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getRules } from "@/i18n/dictionaries/rules";

// Shown instead of a blank error page. The most common cause is a page left open
// while a new version was published; reloading fixes it and the cart is kept.
export default function LocaleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ locale?: string }>();
  const loc = params?.locale;
  const r = getRules(isLocale(loc) ? loc : "fa");
  return (
    <div className="card mx-auto max-w-md space-y-4 text-center">
      <h1 className="text-xl font-bold">{r.errorTitle}</h1>
      <p className="text-sm text-muted">{r.errorBody}</p>
      <div className="flex justify-center gap-2">
        <button className="btn" onClick={() => window.location.reload()}>{r.reload}</button>
        <button className="btn-ghost" onClick={() => reset()}>{r.retry}</button>
      </div>
    </div>
  );
}
