"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type Point = { lat: number; lng: number };
type Marker = Point & { name: string };
type Labels = {
  search: string; searchBtn: string; noResults: string; searchError: string;
  myLocation: string; locating: string; denied: string; mapHelp: string;
  addressLine: string; addressHint: string; mapLoading: string;
};
type Hit = { lat: string; lon: string; display_name: string };

// Pick a delivery point on a map. Writes hidden lat/lng inputs (and an editable
// address line) into the surrounding form. Map tiles and search come from the
// providers set in Dorva settings (OpenStreetMap by default).
export function MapPicker({ tileUrl, attribution, searchUrl, center, initial, initialLine = "", markers, locale, labels, withAddress, onChange }: {
  onChange?: (p: Point) => void;
  tileUrl: string; attribution: string; searchUrl: string;
  center: Point; initial: Point | null; initialLine?: string; markers: Marker[];
  locale: string; labels: Labels; withAddress: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const pin = useRef<any>(null);
  const edited = useRef(false);
  const [ready, setReady] = useState(false);
  const [point, setPoint] = useState<Point | null>(initial);
  const [line, setLine] = useState(initialLine);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // describe the point in words (Nominatim reverse) unless the customer typed their own
  async function describe(p: Point) {
    if (!searchUrl || edited.current) return;
    try {
      const r = await fetch(`${searchUrl}/reverse?format=jsonv2&zoom=18&lat=${p.lat}&lon=${p.lng}&accept-language=${locale}`);
      const j = await r.json();
      const a = j?.address ?? {};
      const parts = [a.city || a.town || a.village, a.suburb || a.neighbourhood || a.quarter, a.road, a.house_number]
        .filter(Boolean);
      if (!edited.current) setLine(parts.length ? parts.join("، ") : String(j?.display_name ?? ""));
    } catch { /* address stays empty; the customer can type it */ }
  }

  function moveTo(p: Point, zoom?: number) {
    const fixed = { lat: Number(p.lat.toFixed(5)), lng: Number(p.lng.toFixed(5)) };
    setPoint(fixed);
    onChange?.(fixed);
    if (pin.current) pin.current.setLatLng([fixed.lat, fixed.lng]);
    if (map.current) map.current.setView([fixed.lat, fixed.lng], zoom ?? Math.max(map.current.getZoom(), 15));
    void describe(fixed);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!alive || !box.current || map.current) return;
      const start = initial ?? center;
      const m = L.map(box.current, { zoomControl: true }).setView([start.lat, start.lng], initial ? 16 : 12);
      L.tileLayer(tileUrl, { maxZoom: 19, attribution }).addTo(m);
      for (const ph of markers) {
        L.circleMarker([ph.lat, ph.lng], { radius: 7, color: "#047857", fillColor: "#10b981", fillOpacity: 0.85, weight: 2 })
          .bindTooltip(ph.name).addTo(m);
      }
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#dc2626;border:3px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [22, 22], iconAnchor: [11, 22],
      });
      const p = L.marker([start.lat, start.lng], { draggable: true, icon });
      if (initial) p.addTo(m);
      p.on("dragend", () => { const ll = p.getLatLng(); moveTo({ lat: ll.lat, lng: ll.lng }, m.getZoom()); });
      m.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        if (!m.hasLayer(p)) p.addTo(m);
        moveTo({ lat: e.latlng.lat, lng: e.latlng.lng }, m.getZoom());
      });
      map.current = m;
      pin.current = p;
      setReady(true);
    })();
    return () => { alive = false; map.current?.remove(); map.current = null; };
    // the map is created once; later prop changes come with a page reload
  }, []);

  function place(p: Point) {
    if (map.current && pin.current && !map.current.hasLayer(pin.current)) pin.current.addTo(map.current);
    moveTo(p, 16);
  }

  async function runSearch() {
    if (!searchUrl || q.trim().length < 2) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`${searchUrl}/search?format=jsonv2&limit=5&countrycodes=ir&accept-language=${locale}&q=${encodeURIComponent(q.trim())}`);
      const j = (await r.json()) as Hit[];
      setHits(j);
      if (!j.length) setMsg(labels.noResults);
    } catch {
      setHits(null); setMsg(labels.searchError);
    }
    setBusy(false);
  }

  function locate() {
    if (!navigator.geolocation) return setMsg(labels.denied);
    setBusy(true); setMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setBusy(false); place({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { setBusy(false); setMsg(labels.denied); },
      { timeout: 10000, enableHighAccuracy: true },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {searchUrl && (
          <>
            <input className="input min-w-0 flex-1" value={q} placeholder={labels.search}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runSearch(); } }} />
            <button type="button" className="btn-ghost" onClick={runSearch} disabled={busy}>{labels.searchBtn}</button>
          </>
        )}
        <button type="button" className="btn-ghost" onClick={locate} disabled={busy}>
          {busy ? labels.locating : labels.myLocation}
        </button>
      </div>
      {hits && hits.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
          {hits.map((h, i) => (
            <li key={i}>
              <button type="button" className="w-full px-3 py-2 text-start hover:bg-brand-50"
                onClick={() => { setHits(null); place({ lat: Number(h.lat), lng: Number(h.lon) }); }}>
                {h.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-sm text-amber-800">{msg}</p>}
      <p className="text-xs text-muted">{labels.mapHelp}</p>
      <div dir="ltr" className="relative z-0 h-80 overflow-hidden rounded-xl border border-line bg-slate-100">
        <div ref={box} className="h-full w-full" />
        {!ready && <p className="absolute inset-0 grid place-items-center text-sm text-muted">{labels.mapLoading}</p>}
      </div>
      <input type="hidden" name="lat" value={point?.lat ?? ""} />
      <input type="hidden" name="lng" value={point?.lng ?? ""} />
      {withAddress && (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{labels.addressLine}</span>
          <textarea name="address_line" rows={2} maxLength={300} className="input w-full" value={line}
            onChange={(e) => { edited.current = true; setLine(e.target.value); }} />
          <span className="text-xs text-muted">{labels.addressHint}</span>
        </label>
      )}
    </div>
  );
}
