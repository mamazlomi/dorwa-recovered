"use client";

import { useEffect } from "react";

const send = (body: Record<string, unknown>) =>
  fetch("/api/finder/event", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true,
  }).catch(() => {});

/** Call button: dials on a phone and records one anonymous call click. */
export function FinderCall({ phone, drug, pharmacy, city, label }: {
  phone: string; drug: string; pharmacy: string; city: number | null; label: string;
}) {
  const tel = phone.replace(/[^\d+]/g, "");
  return (
    <a href={`tel:${tel}`} className="btn shrink-0" onClick={() => { send({ kind: "call", drug, pharmacy, city }); }}>
      {label}
    </a>
  );
}

/** One anonymous view of a medicine per browser session. */
export function FinderView({ drug, city }: { drug: string; city: number | null }) {
  useEffect(() => {
    const key = `dorva_fv_${drug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked: count once per page load */
    }
    send({ kind: "view", drug, city });
  }, [drug, city]);
  return null;
}
