"use client";

import { Children, useEffect, useRef, useState } from "react";

// Slider for the page builder banner: swipe on phones, dots everywhere,
// advances by itself every few seconds unless the visitor is interacting.
export function BannerCarousel({ children, label, interval = 6000, peek = false, rounded = true }: {
  children: React.ReactNode; label?: string; interval?: number;
  /** show a part of the next slide */ peek?: boolean;
  /** round the slider's corners (off when the slides have their own shape) */ rounded?: boolean;
}) {
  const slides = Children.toArray(children);
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [hold, setHold] = useState(false);

  const show = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const n = (i + slides.length) % slides.length;
    // scroll only the slider (never the page), so the slide's start edge meets the slider's
    const child = el.children[n] as HTMLElement | undefined;
    if (!child) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const a = child.getBoundingClientRect(), b = el.getBoundingClientRect();
    el.scrollBy({ left: rtl ? a.right - b.right : a.left - b.left, behavior: "smooth" });
    setAt(n);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) setAt(Number((e.target as HTMLElement).dataset.i));
    }, { root: el, threshold: [0.6] });
    Array.from(el.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [slides.length]);
  useEffect(() => {
    if (slides.length < 2 || hold) return;
    const id = setInterval(() => show(at + 1), interval);
    return () => clearInterval(id);
  });

  return (
    <section aria-roledescription="carousel" aria-label={label} className="relative"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onTouchStart={() => setHold(true)}>
      <div ref={ref} className={`no-scrollbar flex snap-x snap-mandatory overflow-x-auto ${rounded ? "rounded-3xl" : ""} ${peek ? "gap-3" : ""}`}>
        {slides.map((s, i) => (
          <div key={i} data-i={i} className={`shrink-0 ${peek ? "w-[86%] snap-start sm:w-[72%]" : "w-full snap-center"}`} aria-roledescription="slide">{s}</div>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
          {slides.map((_, i) => (
            <button key={i} type="button" aria-label={String(i + 1)} aria-current={i === at}
              onClick={() => show(i)}
              className={`h-2 rounded-full transition-all ${i === at ? "w-6 bg-white" : "w-2 bg-white/60 hover:bg-white/80"}`} />
          ))}
        </div>
      )}
    </section>
  );
}
