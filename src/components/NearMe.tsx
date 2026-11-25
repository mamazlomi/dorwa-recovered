"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatNumber, localized, type Locale } from "@/i18n/config";

type Labels = { button: string; locating: string; noGeo: string; denied: string; failed: string; none: string; km: string; unavailable?: string };
type Result = { pharmacy_id: string; slug: string; name_fa: string; name_i18n: Record<string, string>; distance_km: number };

export function NearMe({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [state, setState] = useState<"idle" | "locating" | "done" | "error">("idle");
  const [results, setResults] = useState<Result[]>([]);
  const [message, setMessage] = useState("");

  async function search(lat: number, lng: number) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("search_pharmacies", { p_lat: lat, p_lng: lng, p_limit: 6 });
    if (error) {
      setState("error");
      setMessage(labels.failed);
      return;
    }
    setResults((data as Result[]) ?? []);
    setState("done");
  }

  function locate() {
    if (!navigator.geolocation) {
      setState("error");
      setMessage(labels.noGeo);
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => search(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        setState("error");
        // 1 = the visitor or the system refused; 2/3 = no fix (common on desktops,
        // where the browser's network location service may be unreachable)
        setMessage(err.code === 1 ? labels.denied : labels.unavailable ?? labels.denied);
      },
      { timeout: 15000, maximumAge: 300000 },
    );
  }

  return (
    <div>
      <button className="btn" onClick={locate} disabled={state === "locating"}>
        {state === "locating" ? labels.locating : labels.button}
      </button>
      {state === "error" && <p className="mt-3 text-sm text-red-700">{message}</p>}
      {state === "done" && (
        <div className="mt-4">
          {results.length === 0 ? (
            <p className="text-sm text-muted">{labels.none}</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-white">
              {results.map((r) => (
                <li key={r.pharmacy_id}>
                  <Link href={`/${locale}/${r.slug}`} className="flex items-center justify-between px-4 py-3 hover:bg-brand-50">
                    <span className="font-medium">{localized(r.name_fa, r.name_i18n, locale)}</span>
                    <span className="text-sm text-muted">{formatNumber(r.distance_km, locale)} {labels.km}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
