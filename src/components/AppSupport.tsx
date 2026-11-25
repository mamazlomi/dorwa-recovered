"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = "dorva-install-later";

// Registers the service worker (installable app, offline notice) and, on phones,
// offers to install Dorva on the home screen. iPhones get the Safari steps instead.
export function AppSupport({ install, raised, texts }: {
  install: boolean; raised: boolean;
  texts: { title: string; body: string; btn: string; later: string; ios: string };
}) {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    if (!install) return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    const phone = window.matchMedia("(max-width: 767px)").matches;
    let later = false;
    try { later = Number(localStorage.getItem(KEY) ?? 0) > Date.now(); } catch { /* storage unavailable */ }
    if (standalone || !phone || later) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); setOpen(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    let t: ReturnType<typeof setTimeout> | undefined;
    if (isIos) { setIos(true); t = setTimeout(() => setOpen(true), 4000); }
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); if (t) clearTimeout(t); };
  }, [install]);

  const later = () => {
    setOpen(false);
    try { localStorage.setItem(KEY, String(Date.now() + 14 * 24 * 3600 * 1000)); } catch { /* storage unavailable */ }
  };
  if (!open) return null;
  return (
    <div role="dialog" aria-label={texts.title}
      className={`fixed inset-x-3 z-50 rounded-2xl border border-line bg-white p-4 shadow-xl md:hidden ${raised ? "bottom-20" : "bottom-4"}`}>
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{texts.title}</p>
          <p className="mt-0.5 text-sm leading-6 text-muted">{ios ? texts.ios : texts.body}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2 text-sm">
        <button type="button" className="btn-ghost py-1.5" onClick={later}>{texts.later}</button>
        {evt && (
          <button type="button" className="btn py-1.5" onClick={async () => { await evt.prompt(); await evt.userChoice.catch(() => null); setOpen(false); setEvt(null); }}>{texts.btn}</button>
        )}
      </div>
    </div>
  );
}
