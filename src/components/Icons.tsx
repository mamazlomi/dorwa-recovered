// Line icons for page builder tiles and the feature strip (24×24, stroke = currentColor).
// The list must match v_icons in app.page_validate.
export const ICONS: Record<string, string> = {
  pill: "M10.5 4.5a4.95 4.95 0 0 1 7 7l-6 6a4.95 4.95 0 0 1-7-7l6-6ZM7.5 7.5l7 7",
  drop: "M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Zm-2.5 11.5a2.5 2.5 0 0 0 2.5 2.5",
  bottle: "M9 3h6M10 3v3l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9l-2-3V3M8 13h8",
  baby: "M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-6 16c0-3.3 2.7-6 6-6s6 2.7 6 6M10 7h.01M14 7h.01",
  device: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 4h8v5H8zM12 16v2",
  leaf: "M5 19c0-8 6-14 15-14 0 9-6 15-14 15H5Zm0 0 8-8",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  bone: "M8 6a2.5 2.5 0 1 0-3 3l9 9a2.5 2.5 0 1 0 3-3L8 6Zm10 0a2.5 2.5 0 1 1-3-3M6 18a2.5 2.5 0 1 1 3 3",
  shield: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  map: "M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  pharmacist: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M12 14v4m-2-2h4",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm9 16-4-4M9 11h4m-2-2v4",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  chat: "M4 5h16v11H8l-4 4V5Zm4 5h.01M12 10h.01M16 10h.01",
  rx: "M6 4h5a3 3 0 0 1 0 6H6V4Zm0 6v10m4-10 8 10m0-6-6 6M4 2h16",
  tooth: "M7 3c-2 0-3 2-3 4 0 3 1 4 1.5 7S7 21 8.5 21s1.5-5 3.5-5 2 5 3.5 5S18 17 18.5 14 20 10 20 7c0-2-1-4-3-4-1.5 0-3 1-5 1S8.5 3 7 3Z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
  vitamin: "M9 3h6v3H9zM8 6h8a1 1 0 0 1 1 1v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1Zm1 6h6v5H9z",
  store: "M4 9l1.5-5h13L20 9M4 9h16M4 9v11h16V9M9 20v-6h6v6M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0",
};
export const ICON_NAMES = Object.keys(ICONS);

export function Icon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  const d = ICONS[name] ?? ICONS.pill;
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}

/** Tile and slide colors; the list must match v_tones in app.page_validate. */
export const TONES: Record<string, { tile: string; slide: string }> = {
  brand: { tile: "bg-brand-50 text-brand-700", slide: "from-brand-700 via-brand-600 to-brand-400" },
  accent: { tile: "bg-accent-50 text-accent-700", slide: "from-accent-700 via-accent-600 to-brand-400" },
  sky: { tile: "bg-sky-50 text-sky-700", slide: "from-sky-800 via-sky-600 to-cyan-500" },
  rose: { tile: "bg-rose-50 text-rose-700", slide: "from-rose-700 via-rose-600 to-pink-500" },
  amber: { tile: "bg-amber-50 text-amber-700", slide: "from-amber-700 via-orange-600 to-amber-500" },
  mint: { tile: "bg-emerald-50 text-emerald-700", slide: "from-emerald-800 via-emerald-600 to-teal-500" },
  dark: { tile: "bg-slate-100 text-slate-800", slide: "from-slate-900 via-slate-800 to-slate-600" },
};
export const TONE_NAMES = Object.keys(TONES);
