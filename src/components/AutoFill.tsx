"use client";

import { useState } from "react";

// Helpers that only fill form fields; the person reviews and saves.

/** Puts a suggested text into an empty-or-not field by id. */
export function SuggestButton({ target, text, label }: { target: string; text: string; label: string }) {
  return (
    <button type="button" className="text-xs font-medium text-brand-700 hover:underline"
      onClick={() => {
        const el = document.getElementById(target);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.value = text; el.focus(); }
      }}>
      {label}
    </button>
  );
}

/**
 * Sends the Persian fields to /api/ai/translate and writes the suggestions
 * into the English and Arabic fields. `fields`: key → {fa, en, ar} element ids.
 */
export function TranslateButton({ fields, pharmacyId, texts, enabled }: {
  fields: Record<string, { fa: string; en: string; ar: string }>;
  pharmacyId?: string | null;
  texts: { translate: string; translating: string; off: string; fail: string; done: string };
  enabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const val = (id: string) => {
    const el = document.getElementById(id);
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : "";
  };
  const put = (id: string, v: string) => {
    const el = document.getElementById(id);
    if (v && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.value = v;
  };
  if (!enabled) return <p className="text-xs text-muted">{texts.off}</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={state === "busy"} className="btn-ghost py-1.5 text-xs"
        onClick={async () => {
          setState("busy");
          try {
            const payload = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, val(f.fa)]));
            const res = await fetch("/api/ai/translate", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ texts: payload, pharmacyId: pharmacyId ?? null }),
            });
            if (!res.ok) throw new Error();
            const j = (await res.json()) as { en: Record<string, string>; ar: Record<string, string>; failed?: boolean };
            for (const [k, f] of Object.entries(fields)) { put(f.en, j.en?.[k] ?? ""); put(f.ar, j.ar?.[k] ?? ""); }
            setState(j.failed ? "fail" : "done");
          } catch {
            setState("fail");
          }
        }}>
        {state === "busy" ? texts.translating : texts.translate}
      </button>
      {state === "done" && <span className="text-xs text-brand-700">{texts.done}</span>}
      {state === "fail" && <span className="text-xs text-red-700">{texts.fail}</span>}
    </div>
  );
}
