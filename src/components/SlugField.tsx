"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeSlug, SLUG_RE } from "@/lib/slug";

// Page address of a new pharmacy. People may type or paste anything (a full link
// like www.dorva.ir/drmazloomi, capitals, spaces); the field shows the address it
// will become and sends that. Messages are in the page's language, not the browser's.
export function SlugField({ name, label, hint, invalid, locale, placeholder }: {
  name: string; label: string; /** with {url} where the address goes */ hint: string; invalid: string; locale: string; placeholder?: string;
}) {
  const [raw, setRaw] = useState("");
  const [host, setHost] = useState("dorva.ir");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setHost(window.location.host.replace(/^www\./, "")); }, []);
  const slug = normalizeSlug(raw);
  const ok = SLUG_RE.test(slug);
  useEffect(() => { ref.current?.setCustomValidity(ok ? "" : invalid); }, [raw, ok, invalid]);
  return (
    <div>
      <label className="label" htmlFor={`${name}-input`}>{label}</label>
      <input ref={ref} id={`${name}-input`} required dir="ltr" autoComplete="off" spellCheck={false} placeholder={placeholder}
        className="input" value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={() => ok && setRaw(slug)} />
      <input type="hidden" name={name} value={slug} />
      <p className={`mt-1 text-xs ${raw && !ok ? "text-red-700" : "text-muted"}`} dir="auto">
        {raw && !ok ? invalid : hint.replace("{url}", `${host}/${locale}/${slug || "…"}`)}
      </p>
    </div>
  );
}
