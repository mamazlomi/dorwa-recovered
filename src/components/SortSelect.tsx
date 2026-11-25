"use client";

import { useRouter } from "next/navigation";

// Customer sort menu: each option carries its full URL (built on the server),
// so filters, search and collection are kept and paging restarts at 1.
export function SortSelect({ label, current, options }: {
  label: string; current: string; options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select value={current} aria-label={label} className="input w-auto py-1.5 text-sm"
        onChange={(e) => {
          const o = options.find((x) => x.value === e.target.value);
          if (o) router.push(o.href, { scroll: false });
        }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
