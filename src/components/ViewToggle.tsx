"use client";

import { useRouter } from "next/navigation";

// Grid / list switch for product lists; remembered in a cookie for this browser.
export function ViewToggle({ current, labels }: { current: "grid" | "list"; labels: Record<string, string> }) {
  const router = useRouter();
  const set = (v: "grid" | "list") => {
    document.cookie = `dorva_view=${v}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  };
  const icon = { grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", list: "M4 6h16M4 12h16M4 18h16" };
  return (
    <div className="flex overflow-hidden rounded-xl border border-line text-xs" role="group">
      {(["grid", "list"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={current === v} title={labels[v]} onClick={() => set(v)}
          className={`flex items-center gap-1 px-2.5 py-1.5 ${current === v ? "bg-brand-600 text-white" : "bg-white hover:bg-brand-50"}`}>
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}><path d={icon[v]} /></svg>
          <span className="hidden sm:inline">{labels[v]}</span>
        </button>
      ))}
    </div>
  );
}
