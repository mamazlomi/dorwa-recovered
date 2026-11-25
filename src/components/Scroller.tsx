"use client";

import { useEffect, useRef, useState } from "react";

// A horizontal row that scrolls by touch on phones and with arrow buttons on
// larger screens, so cards at the edge read as "more to see", not as overflow.
export function Scroller({ children, label, className = "", arrows = true }: { children: React.ReactNode; label?: string; className?: string; arrows?: boolean }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft); // RTL browsers report negative positions
    setEdge({ start: pos < 4, end: pos > max - 4 });
  };
  useEffect(() => {
    update();
    const el = ref.current;
    el?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  const by = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.85, behavior: "smooth" });
  };
  const btn = "absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-xl shadow-md transition hover:bg-brand-50 sm:flex";
  return (
    <div className="relative">
      <ul ref={ref} aria-label={label} className={`no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto scroll-smooth px-1 pb-2 ${className}`}>
        {children}
      </ul>
      {arrows && !edge.start && <button type="button" aria-label="‹" onClick={() => by(-1)} className={`${btn} -start-3`}><span aria-hidden className="rtl:rotate-180">‹</span></button>}
      {arrows && !edge.end && <button type="button" aria-label="›" onClick={() => by(1)} className={`${btn} -end-3`}><span aria-hidden className="rtl:rotate-180">›</span></button>}
    </div>
  );
}
