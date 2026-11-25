"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// A <details> menu that closes itself after a link inside it is used, on a
// click outside it, and on Escape (a plain <details> stays open across pages).
export function Dropdown({ summary, summaryClass, children, className = "relative" }: {
  summary: React.ReactNode; summaryClass: string; children: React.ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  useEffect(() => { ref.current?.removeAttribute("open"); }, [path]);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") el.removeAttribute("open"); return; }
      if (!el.contains(e.target as Node)) el.removeAttribute("open");
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, []);
  return (
    <details ref={ref} className={className}
      onClick={(e) => { if ((e.target as HTMLElement).closest("a")) ref.current?.removeAttribute("open"); }}>
      <summary className={summaryClass}>{summary}</summary>
      {children}
    </details>
  );
}
