"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { NotifyTexts } from "@/i18n/dictionaries/notify";

type Item = { id: number; event: string; title: Record<string, string>; body: Record<string, string>; link: string | null; alarm: boolean; at: string; read: boolean };
type Feed = { unread: number; items: Item[] };

const POLL = 20_000;
const POLL_HIDDEN = 60_000;
const FRESH_MS = 10 * 60_000; // on page load, alarms younger than this still ring
const LS_MUTE = "dorva-notify-mute";
const LS_LAST = "dorva-notify-last";

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// a short two-tone alarm made with WebAudio (no sound file to download)
function useAlarm() {
  const ctx = useRef<AudioContext | null>(null);
  const [locked, setLocked] = useState(true);
  useEffect(() => {
    const unlock = () => {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx.current ??= new AC();
        void ctx.current.resume().then(() => setLocked(ctx.current?.state !== "running"));
      } catch { /* no audio */ }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);
  const play = useCallback((strong: boolean) => {
    const c = ctx.current;
    if (!c || c.state !== "running") return;
    const tones = strong ? [880, 660, 880, 660] : [880, 660];
    tones.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = c.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.26);
    });
    try { navigator.vibrate?.(strong ? [300, 150, 300] : 150); } catch { /* not supported */ }
  }, []);
  return { play, locked };
}

const b64ToBytes = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};

/** Bell in the header: unread count, list, popups with alarm sound, and device push activation. */
export function NotifyBell({ locale, T, supabaseUrl }: { locale: string; T: NotifyTexts; supabaseUrl: string }) {
  const supabase = useRef(createClient()).current;
  const [feed, setFeed] = useState<Feed>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [popups, setPopups] = useState<Item[]>([]);
  const [muted, setMuted] = useState(false);
  const [push, setPush] = useState<"unknown" | "on" | "off" | "denied" | "unsupported" | "busy" | "fail">("unknown");
  const last = useRef<number>(0);
  const first = useRef(true);
  const { play, locked } = useAlarm();
  const tx = (o: Record<string, string>) => o?.[locale] || o?.fa || "";

  useEffect(() => {
    setMuted(ls.get(LS_MUTE) === "1");
    last.current = Number(ls.get(LS_LAST) ?? 0) || 0;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setPush("unsupported"); return; }
    if (Notification.permission === "denied") { setPush("denied"); return; }
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setPush(s ? "on" : "off")).catch(() => setPush("off"));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_notifications", { p_after: 0, p_limit: 30 });
    if (!data) return;
    const f = data as Feed;
    setFeed(f);
    const now = Date.now();
    const fresh = f.items.filter((i) => !i.read && i.id > last.current
      && (!first.current || now - new Date(i.at).getTime() < FRESH_MS));
    first.current = false;
    if (f.items.length) {
      last.current = Math.max(last.current, ...f.items.map((i) => i.id));
      ls.set(LS_LAST, String(last.current));
    }
    if (fresh.length) {
      setPopups((p) => [...fresh.slice(0, 3), ...p.filter((x) => !fresh.some((y) => y.id === x.id))].slice(0, 4));
      if (ls.get(LS_MUTE) !== "1") play(fresh.some((i) => i.alarm));
    }
  }, [supabase, play]);

  // polling (slower in the background) plus an instant refresh when a push arrives
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await load().catch(() => null);
      t = setTimeout(tick, document.hidden ? POLL_HIDDEN : POLL);
    };
    void tick();
    const onMsg = (e: MessageEvent) => { if ((e.data as { type?: string })?.type === "dorva-notify") void load(); };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    const onVis = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); navigator.serviceWorker?.removeEventListener("message", onMsg); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // repeating alarm until acknowledged
  useEffect(() => {
    if (!popups.some((p) => p.alarm) || muted) return;
    const id = setInterval(() => play(true), 8000);
    return () => clearInterval(id);
  }, [popups, muted, play]);

  const markRead = async (ids: number[] | null) => {
    await supabase.rpc("notifications_read", { p_ids: ids });
    setPopups((p) => (ids ? p.filter((x) => !ids.includes(x.id)) : []));
    void load();
  };

  const enablePush = async () => {
    try {
      setPush("busy");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setPush(perm === "denied" ? "denied" : "off"); return; }
      let key = (await supabase.rpc("notify_public_key")).data as string | null;
      if (!key) {
        const res = await fetch(`${supabaseUrl}/functions/v1/notify-dispatch`);
        key = res.ok ? ((await res.json()) as { publicKey?: string }).publicKey ?? null : null;
      }
      if (!key) { setPush("fail"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const { data } = await supabase.rpc("push_subscribe", {
        p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent.slice(0, 200),
      });
      setPush(data === "ok" ? "on" : "fail");
    } catch {
      setPush("fail");
    }
  };

  const toggleMute = () => { const m = !muted; setMuted(m); ls.set(LS_MUTE, m ? "1" : "0"); };
  const when = (s: string) => new Date(s).toLocaleString(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={T.bell} aria-expanded={open}
          className="relative grid h-9 w-9 place-items-center rounded-full hover:bg-brand-50">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {feed.unread > 0 && (
            <span className="absolute -top-0.5 -end-0.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white">
              {feed.unread > 99 ? "99+" : feed.unread}
            </span>
          )}
        </button>
        {open && (
          <div className="absolute end-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <b className="text-sm">{T.bell}</b>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={toggleMute} className="text-muted hover:underline">{muted ? T.unmute : T.mute}</button>
                {feed.unread > 0 && <button type="button" onClick={() => markRead(null)} className="text-brand-700 hover:underline">{T.markAll}</button>}
              </div>
            </div>
            {locked && !muted && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">{T.soundHint}</p>}
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {feed.items.length === 0 && <li className="p-2 text-xs text-muted">{T.empty}</li>}
              {feed.items.map((i) => (
                <li key={i.id} className={`rounded-lg p-2 text-xs ${i.read ? "" : "bg-brand-50"}`}>
                  <Link href={i.link ?? "#"} onClick={() => { void markRead([i.id]); setOpen(false); }} className="block">
                    <b className="block">{tx(i.title)}</b>
                    {tx(i.body) && <span className="block text-muted">{tx(i.body)}</span>}
                    <span className="block text-[10px] text-muted">{when(i.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-2 border-t border-line pt-2 text-xs">
              {push === "on" ? <p className="text-brand-700">✓ {T.pushOn}</p>
                : push === "denied" ? <p className="text-amber-800">{T.pushDenied}</p>
                : push === "unsupported" ? <p className="text-muted">{T.pushUnsupported}</p>
                : <button type="button" onClick={enablePush} disabled={push === "busy"} className="btn w-full py-1.5 text-xs">{T.enablePush}</button>}
              {push === "fail" && <p className="mt-1 text-red-700">{T.pushFail}</p>}
            </div>
          </div>
        )}
      </div>
      {popups.length > 0 && (
        <div className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-md flex-col gap-2" role="alert" aria-live="assertive">
          {popups.map((p) => (
            <div key={p.id} className={`rounded-2xl border p-3 shadow-2xl ${p.alarm ? "animate-pulse border-red-400 bg-red-50" : "border-brand-300 bg-surface"}`}>
              <b className="block text-sm">{tx(p.title)}</b>
              {tx(p.body) && <p className="mt-0.5 text-xs text-muted">{tx(p.body)}</p>}
              <div className="mt-2 flex gap-2">
                {p.link && <Link href={p.link} onClick={() => markRead([p.id])} className="btn py-1 text-xs">{T.open}</Link>}
                <button type="button" onClick={() => markRead([p.id])} className="btn-ghost py-1 text-xs">{T.ack}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
