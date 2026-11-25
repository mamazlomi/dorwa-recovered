"use client";

import { useState } from "react";

type Labels = { location: string; lat: string; lng: string; useMyLocation: string; locating: string; located: string; noGeo: string; geoDenied: string };

export function LocationFields({ labels }: { labels: Labels }) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [note, setNote] = useState("");

  function fill() {
    if (!navigator.geolocation) return setNote(labels.noGeo);
    setNote(labels.locating);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setNote(labels.located);
      },
      () => setNote(labels.geoDenied),
    );
  }

  return (
    <div className="sm:col-span-2">
      <span className="label">{labels.location}</span>
      <div className="grid grid-cols-2 gap-3">
        <input name="lat" required inputMode="decimal" dir="ltr" className="input" placeholder={labels.lat}
          value={lat} onChange={(e) => setLat(e.target.value)} />
        <input name="lng" required inputMode="decimal" dir="ltr" className="input" placeholder={labels.lng}
          value={lng} onChange={(e) => setLng(e.target.value)} />
      </div>
      <button type="button" onClick={fill} className="btn-ghost mt-2">{labels.useMyLocation}</button>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </div>
  );
}
