"use client";

import { Children, useId, useState } from "react";

// Product tabs of the page builder: panels are rendered on the server; this only
// switches which one is visible (arrow keys move between tabs).
export function TabSwitch({ titles, look = "pills", children }: { titles: string[]; look?: string; children: React.ReactNode }) {
  const panels = Children.toArray(children);
  const [at, setAt] = useState(0);
  const id = useId();
  const cls = (on: boolean) =>
    look === "underline" ? `border-b-2 px-3 py-2 ${on ? "border-brand-600 font-bold text-brand-700" : "border-transparent text-muted hover:text-ink"}`
    : look === "boxed" ? `rounded-t-xl border border-b-0 px-4 py-2 ${on ? "border-line bg-white font-bold text-brand-700" : "border-transparent text-muted hover:bg-white/60"}`
    : `rounded-full px-4 py-1.5 ${on ? "bg-brand-600 font-bold text-white" : "bg-brand-50 text-brand-700 hover:bg-brand-100"}`;
  const key = (e: React.KeyboardEvent, i: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    if (!step) return;
    const n = (i + step + titles.length) % titles.length;
    setAt(n);
    document.getElementById(`${id}-t${n}`)?.focus();
  };
  return (
    <div>
      <div role="tablist" className={`no-scrollbar mb-3 flex gap-2 overflow-x-auto text-sm ${look === "underline" ? "gap-0 border-b border-line" : look === "boxed" ? "gap-1 border-b border-line" : ""}`}>
        {titles.map((t, i) => (
          <button key={i} id={`${id}-t${i}`} type="button" role="tab" aria-selected={i === at} aria-controls={`${id}-p${i}`}
            tabIndex={i === at ? 0 : -1} onClick={() => setAt(i)} onKeyDown={(e) => key(e, i)}
            className={`shrink-0 whitespace-nowrap transition ${cls(i === at)}`}>{t}</button>
        ))}
      </div>
      {panels.map((p, i) => (
        <div key={i} id={`${id}-p${i}`} role="tabpanel" aria-labelledby={`${id}-t${i}`} hidden={i !== at}>{p}</div>
      ))}
    </div>
  );
}
