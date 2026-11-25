"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { parseScan, type Scan } from "@/lib/gs1";
import { lookupCode, receiveStock, suggestCode, type CodeHit } from "@/lib/toolActions";
import { createClient } from "@/lib/supabase/client";

type T = Record<string, string>;
type Found = { name_fa: string; id: string };
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type Controls = { stop: () => void };
const fill = (s: string, o: Record<string, string | number>) => Object.entries(o).reduce((a, [k, v]) => a.split(`{${k}}`).join(String(v)), s);

// Pharmacy scanner: camera (or a USB/Bluetooth barcode reader typing into the box)
// → product → quantity, batch, expiry → stock. Unknown codes can be linked to a
// product; the link waits for Dorva's review.
export function Scanner({ pharmacyId, texts: L, sources, errors: E, suggestErrors: SE, canReceive }: {
  pharmacyId: string; texts: T; sources: T; errors: T; suggestErrors: T; canReceive: boolean;
}) {
  const [raw, setRaw] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [hits, setHits] = useState<CodeHit[] | null>(null);
  const [pick, setPick] = useState<CodeHit | Found | null>(null);
  const [qty, setQty] = useState("1");
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [uid, setUid] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<{ name: string; qty: number; batch: string; expiry: string }[]>([]);
  const [cam, setCam] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [pending, start] = useTransition();
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const stopper = useRef<(() => void) | null>(null);

  const stopCam = () => { stopper.current?.(); stopper.current = null; setCam(false); };
  useEffect(() => () => stopper.current?.(), []);

  const find = (value: string) => {
    const s = parseScan(value);
    if (!s.code) return;
    stopCam();
    setScan(s); setRaw(value); setHits(null); setPick(null); setMsg(null); setResults([]); setQ("");
    setBatch(s.batch ?? ""); setExpiry(s.expiry ?? ""); setUid(s.serial ?? ""); setQty("1");
    start(async () => {
      const h = await lookupCode(pharmacyId, s.code);
      setHits(h);
      if (h.length === 1) setPick(h[0]);
    });
  };

  const startCam = async () => {
    setMsg(null);
    try {
      setCam(true);
      await new Promise((r) => setTimeout(r, 0));
      const v = video.current!;
      const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector };
      if (W.BarcodeDetector) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        v.srcObject = stream;
        await v.play();
        const det = new W.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "data_matrix", "qr_code"] });
        let live = true;
        stopper.current = () => { live = false; stream.getTracks().forEach((t) => t.stop()); };
        const tick = async () => {
          if (!live) return;
          try {
            const r = await det.detect(v);
            if (r[0]?.rawValue) { find(r[0].rawValue); return; }
          } catch { /* frame not ready */ }
          setTimeout(tick, 250);
        };
        tick();
      } else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls: Controls = await reader.decodeFromVideoDevice(undefined, v, (res) => { if (res) find(res.getText()); });
        stopper.current = () => controls.stop();
      }
    } catch {
      stopCam();
      setMsg({ ok: false, text: L.noCamera });
    }
  };

  const search = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) { setResults([]); return; }
    const term = v.trim().replace(/[%,()]/g, " ");
    const { data } = await createClient().from("catalog_products").select("id, name_fa")
      .or(`name_fa.ilike.%${term}%,generic_name.ilike.%${term}%,name_en.ilike.%${term}%`).limit(10);
    setResults((data as Found[] | null) ?? []);
  };

  const link = (p: Found) => start(async () => {
    const r = await suggestCode(pharmacyId, scan?.code ?? raw, p.id);
    if (r === "ok") { setPick(p); setResults([]); setMsg({ ok: true, text: fill(L.suggested, { p: p.name_fa }) }); }
    else setMsg({ ok: false, text: SE[r] ?? E.unknown });
  });

  const receive = () => {
    if (!pick) return;
    const id = "product_id" in pick ? pick.product_id : pick.id;
    const n = Number(qty);
    start(async () => {
      const r = await receiveStock(pharmacyId, id, n, batch, expiry, uid);
      if (r !== "ok") { setMsg({ ok: false, text: E[r] ?? E.unknown }); return; }
      setLog((l) => [{ name: pick.name_fa, qty: n, batch, expiry }, ...l]);
      setMsg({ ok: true, text: fill(L.received, { n, p: pick.name_fa }) });
      setScan(null); setHits(null); setPick(null); setRaw("");
      box.current?.focus();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <div className="card space-y-3">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); find(raw); }}>
            <input ref={box} autoFocus dir="ltr" className="input min-w-0 flex-1" placeholder={L.manual} value={raw} onChange={(e) => setRaw(e.target.value)} />
            <button className="btn" disabled={pending || !raw.trim()}>{L.find}</button>
            {cam ? <button type="button" className="btn-ghost" onClick={stopCam}>{L.stop}</button>
                 : <button type="button" className="btn-ghost" onClick={startCam}>📷 {L.camera}</button>}
          </form>
          <video ref={video} muted playsInline className={`${cam ? "block" : "hidden"} aspect-video w-full rounded-xl bg-black object-cover`} />
          {pending && !hits && <p className="text-sm text-muted">{L.looking}</p>}
          {msg && <p role="status" className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-700"}`}>{msg.text}</p>}
        </div>

        {hits && hits.length === 0 && !pick && scan && (
          <div className="card space-y-3 border-amber-300">
            <p className="font-semibold text-amber-900">{fill(L.unknownCode, { c: scan.code })}</p>
            <p className="text-sm text-muted">{L.linkIntro}</p>
            <input className="input" placeholder={L.searchPh} value={q} onChange={(e) => search(e.target.value)} />
            <ul className="divide-y divide-line rounded-xl border border-line">
              {results.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                  <span>{p.name_fa}</span>
                  <button type="button" className="btn-ghost py-1 text-xs" disabled={pending} onClick={() => link(p)}>{L.choose}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hits && hits.length > 1 && !pick && (
          <div className="card space-y-2">
            {hits.map((h) => <button key={h.product_id} type="button" className="btn-ghost w-full justify-start text-start" onClick={() => setPick(h)}>{h.name_fa}</button>)}
          </div>
        )}

        {pick && (
          <div className="card space-y-3 border-brand-300">
            <div>
              <p className="text-xs text-muted">{L.found}{"source" in pick ? ` · ${sources[pick.source] ?? pick.source}` : ""}</p>
              <p className="text-lg font-bold">{pick.name_fa}</p>
              {"quantity" in pick && <p className="text-sm text-muted">{pick.quantity != null ? fill(L.inStock, { n: pick.quantity }) : L.notInStock}</p>}
            </div>
            {canReceive && (
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); receive(); }}>
                <label><span className="label">{L.qty}</span><input type="number" min={1} required className="input" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
                <label><span className="label">{L.expiry}</span><input type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
                <label><span className="label">{L.batch}</span><input dir="ltr" className="input" value={batch} maxLength={40} onChange={(e) => setBatch(e.target.value)} /></label>
                <label><span className="label">{L.uid}</span><input dir="ltr" className="input" value={uid} maxLength={80} onChange={(e) => setUid(e.target.value)} /></label>
                <div className="flex gap-2 sm:col-span-2">
                  <button className="btn" disabled={pending}>{L.receive}</button>
                  <button type="button" className="btn-ghost" onClick={() => { setScan(null); setHits(null); setPick(null); setRaw(""); box.current?.focus(); }}>{L.again}</button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      <aside className="card h-fit space-y-2">
        <h2 className="font-bold">{L.session}</h2>
        {log.length === 0 ? <p className="text-sm text-muted">—</p> : (
          <ul className="space-y-2 text-sm">
            {log.map((x, i) => (
              <li key={i} className="rounded-lg bg-paper p-2">
                <p className="font-semibold">{x.qty} × {x.name}</p>
                {(x.batch || x.expiry) && <p className="text-xs text-muted" dir="ltr">{[x.batch, x.expiry].filter(Boolean).join(" · ")}</p>}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
