"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Hit = { term: string; kind: "category" | "brand" | "word"; hits: number };

// One search box for the whole shop (header and products page). Suggests catalog
// words, brands and categories while typing; clearing it on the products page
// shows every product again without pressing "search".
export function HeaderSearch({ locale, placeholder, button, kinds }: {
  locale: string; placeholder: string; button: string; kinds?: Record<string, string>;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const onProducts = path === `/${locale}/products`;
  const current = onProducts ? sp.get("q") ?? "" : "";
  const [q, setQ] = useState(current);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setQ(current); }, [current]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (term: string) => {
    const next = new URLSearchParams(onProducts ? sp.toString() : "");
    next.delete("page"); next.delete("added"); next.delete("col");
    if (term.trim()) next.set("q", term.trim()); else next.delete("q");
    setOpen(false);
    const qs = next.toString();
    router.push(`/${locale}/products${qs ? `?${qs}` : ""}`);
  };

  const change = (v: string) => {
    setQ(v); setActive(-1);
    if (timer.current) clearTimeout(timer.current);
    // emptied on the products page (typing or the × of the field): back to all products
    if (!v.trim() && onProducts && current) { go(""); return; }
    if (v.trim().length < 2) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await createClient().rpc("search_suggest", { p_query: v.trim(), p_limit: 8 });
      setHits((data as Hit[] | null) ?? []);
      setOpen(true);
    }, 250);
  };

  return (
    <div ref={box} className="relative">
      <form role="search" onSubmit={(e) => { e.preventDefault(); go(active >= 0 ? hits[active].term : q); }} className="flex gap-2">
        <input type="search" name="q" value={q} placeholder={placeholder} aria-label={placeholder} autoComplete="off"
          role="combobox" aria-expanded={open && hits.length > 0} aria-controls="search-suggest"
          className="input rounded-full bg-paper"
          onChange={(e) => change(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
            if (e.key === "Escape") setOpen(false);
          }} />
        <button className="btn shrink-0 rounded-full">{button}</button>
      </form>
      {open && hits.length > 0 && (
        <ul id="search-suggest" role="listbox" className="absolute inset-x-0 z-40 mt-1 overflow-hidden rounded-2xl border border-line bg-white py-1 shadow-lg">
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.term}`} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => go(h.term)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-start text-sm hover:bg-brand-50 ${i === active ? "bg-brand-50" : ""}`}>
                <span className="truncate">{h.term}</span>
                {kinds?.[h.kind] && <span className="shrink-0 text-xs text-muted">{kinds[h.kind]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
