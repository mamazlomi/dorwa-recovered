"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { key: string; href: string; label: string; icon: string; badge?: string };

// App-style bottom menu on phones (all phones, or only inside the installed app).
export function BottomNav({ items, onlyApp, label }: { items: Item[]; onlyApp: boolean; label: string }) {
  const path = usePathname();
  const active = (href: string) => {
    const p = href.split("?")[0];
    return p.split("/").length <= 2 ? path === p : path.startsWith(p);
  };
  return (
    <nav aria-label={label}
      className={`${onlyApp ? "app-only" : ""} fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden`}>
      <ul className="grid grid-cols-5">
        {items.map((it) => {
          const on = active(it.href);
          return (
            <li key={it.key}>
              <Link href={it.href} aria-current={on ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-bold text-brand-700" : "text-muted"}`}>
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${on ? "bg-brand-50" : ""}`}>
                  <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d={it.icon} /></svg>
                </span>
                {it.label}
                {it.badge && <span className="absolute end-[22%] top-1 min-w-4 rounded-full bg-accent-600 px-1 text-center text-[10px] leading-4 text-white">{it.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
