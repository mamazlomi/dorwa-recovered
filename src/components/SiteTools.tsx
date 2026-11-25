"use client";

import { useEffect, useState } from "react";

// Floating page tools chosen in the theme studio: "back to top" in several
// styles, an optional "to the bottom" button and a reading progress bar.
export function SiteTools({ style, side, toBottom, progress, raised, labels }: {
  style: string; side: string; toBottom: boolean; progress: boolean;
  /** lift above the bottom menu on phones */ raised: boolean;
  labels: { top: string; bottom: string };
}) {
  const [y, setY] = useState(0);
  const [max, setMax] = useState(1);
  useEffect(() => {
    const on = () => { setY(window.scrollY); setMax(Math.max(1, document.documentElement.scrollHeight - window.innerHeight)); };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  const ratio = Math.min(1, y / max);
  const go = (top: number) => window.scrollTo({ top, behavior: "smooth" });
  const showTop = style !== "none" && y > 600;
  const showBottom = toBottom && ratio < 0.85 && max > 1200;
  const pos = side === "center" ? "left-1/2 -translate-x-1/2" : side === "start" ? "start-4" : "end-4";
  const bottom = raised ? "bottom-20 md:bottom-6" : "bottom-6";
  const base = "fixed z-40 flex items-center justify-center bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const arrow = (down = false) => (
    <svg aria-hidden viewBox="0 0 24 24" className={`h-5 w-5 ${down ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M6 14l6-6 6 6" /></svg>
  );
  const shape = style === "square" ? "h-11 w-11 rounded-xl" : style === "pill" ? "h-11 gap-1.5 rounded-full px-4 text-sm font-semibold"
    : style === "tab" ? `h-12 w-10 ${side === "start" ? "rounded-e-xl start-0" : "rounded-s-xl end-0"}` : "h-12 w-12 rounded-full";
  const tabPos = style === "tab" ? (side === "start" ? "start-0" : "end-0") : pos;
  return (
    <>
      {progress && (
        <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-1 bg-transparent">
          <div className="h-full bg-gradient-to-l from-brand-400 to-accent-600 transition-[width] duration-150 rtl:ms-auto" style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
      {showTop && (
        <button type="button" aria-label={labels.top} title={labels.top} onClick={() => go(0)} className={`${base} ${shape} ${tabPos} ${bottom}`}>
          {style === "ring" && (
            <svg aria-hidden viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
              <circle cx="24" cy="24" r="21" fill="none" stroke="rgb(255 255 255 / .25)" strokeWidth="3" />
              <circle cx="24" cy="24" r="21" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={132} strokeDashoffset={132 * (1 - ratio)} />
            </svg>
          )}
          {arrow()}
          {style === "pill" && <span>{labels.top}</span>}
        </button>
      )}
      {showBottom && (
        <button type="button" aria-label={labels.bottom} title={labels.bottom} onClick={() => go(max)}
          className={`${base} h-10 w-10 rounded-full bg-white text-brand-700 ring-1 ring-line hover:bg-brand-50 ${side === "center" ? "end-4" : pos} ${raised ? "bottom-36 md:bottom-20" : "bottom-20"}`}>
          {arrow(true)}
        </button>
      )}
    </>
  );
}
