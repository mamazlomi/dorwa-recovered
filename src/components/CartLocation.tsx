"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Labels = { useLocation: string; locating: string; clearLocation: string; locationDenied: string };

// Stores the customer's rounded location (≈100 m) in a cookie the cart page reads.
export function CartLocation({ active, labels }: { active: boolean; labels: Labels }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function save(value: string, maxAge: number) {
    document.cookie = `dorva_loc=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
    router.refresh();
  }

  function locate() {
    if (!navigator.geolocation) return setError(labels.locationDenied);
    setBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        save(`${pos.coords.latitude.toFixed(3)},${pos.coords.longitude.toFixed(3)}`, 60 * 60 * 24);
      },
      () => {
        setBusy(false);
        setError(labels.locationDenied);
      },
      { timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn" onClick={locate} disabled={busy}>
        {busy ? labels.locating : labels.useLocation}
      </button>
      {active && (
        <button type="button" className="btn-ghost" onClick={() => save("", 0)}>
          {labels.clearLocation}
        </button>
      )}
      {error && <p className="w-full text-sm text-red-700">{error}</p>}
    </div>
  );
}
