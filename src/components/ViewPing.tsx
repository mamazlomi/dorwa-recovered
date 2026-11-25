"use client";

import { useEffect } from "react";

/** Reports one view of a product page per browser session. */
export function ViewPing({ id }: { id: string }) {
  useEffect(() => {
    const key = `dorva_v_${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked: still count once per page load */
    }
    fetch("/api/track/view", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }), keepalive: true,
    }).catch(() => {});
  }, [id]);
  return null;
}
