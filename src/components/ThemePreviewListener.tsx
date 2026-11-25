"use client";

import { useEffect } from "react";

// Inside the theme studio's preview frame: apply color/shape changes the moment
// they are made (the editor posts the new CSS variables), before the draft is saved.
export function ThemePreviewListener() {
  useEffect(() => {
    // inside the studio frame the yellow "previewing" bar is noise
    if (window.top !== window.self) {
      const bar = document.getElementById("theme-preview-bar");
      if (bar) bar.style.display = "none";
      window.parent.postMessage({ type: "dorva-frame-ready", path: window.location.pathname + window.location.search }, window.location.origin);
    }
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; css?: string; attrs?: Record<string, string> } | null;
      if (!d || d.type !== "dorva-theme" || typeof d.css !== "string") return;
      const el = document.getElementById("theme-vars");
      if (el) el.textContent = d.css;
      Object.entries(d.attrs ?? {}).forEach(([k, v]) => { if (k.startsWith("data-")) document.documentElement.setAttribute(k, v); });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  return null;
}
