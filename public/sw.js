// Dorva service worker: makes the site installable and keeps it usable on a
// shaky connection. Pages always come from the network (prices and stock must be
// fresh); only build files and icons are cached. Offline, a short notice is shown.
const CACHE = "dorva-v2";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});

// ---------------------------------------------------------------- notifications (Web Push)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "دوروا", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "دوروا";
  e.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-48.png",
      dir: "rtl",
      lang: "fa",
      tag: d.id ? `dorva-${d.id}` : undefined,
      requireInteraction: !!d.alarm,
      renotify: !!d.alarm,
      vibrate: d.alarm ? [400, 200, 400, 200, 400] : [200],
      data: { link: d.link || "/fa" },
    });
    // an open tab plays the alarm sound and shows the popup at once
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    tabs.forEach((c) => c.postMessage({ type: "dorva-notify" }));
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/fa";
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of tabs) {
      if ("focus" in c) { await c.focus(); if ("navigate" in c) await c.navigate(link); return; }
    }
    await self.clients.openWindow(link);
  })());
});
