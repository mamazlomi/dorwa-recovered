"use client";

import { useEffect } from "react";

type M = { missing: string; pattern: string; email: string; short: string; range: string };

// Browser form errors ("Please match the requested format") follow the browser's
// language, not the page's. This replaces them, site-wide, with messages in the
// page's language. Fields that set their own message keep it.
export function FormMessages({ m }: { m: M }) {
  useEffect(() => {
    const ours = new WeakSet<Element>();
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (!el?.validity || (el.validity.customError && !ours.has(el))) return;
      const v = el.validity;
      const msg = v.valueMissing ? m.missing : v.typeMismatch ? m.email : v.patternMismatch ? m.pattern
        : v.tooShort ? m.short : v.rangeUnderflow || v.rangeOverflow || v.stepMismatch ? m.range : "";
      if (msg) { el.setCustomValidity(msg); ours.add(el); }
    };
    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (ours.has(el)) { el.setCustomValidity(""); ours.delete(el); }
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
    };
  }, [m]);
  return null;
}
