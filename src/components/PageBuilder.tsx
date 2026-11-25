"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { publishPage, savePage } from "@/lib/pageActions";
import {
  BANDS, DEVICES, DISPLAYS, DIVIDERS, emptyBlock, mediaUrl, MEDIA_BUCKET, newId,
  type Block, type BlockLook, type BlockType, type Device, type I18nText, type PageLink, type ProductSource, type ProductsBlock, type TabsBlock, type TileItem,
} from "@/lib/pageBlocks";
import { Icon, ICON_NAMES, TONE_NAMES, TONES } from "@/components/Icons";
import { createClient } from "@/lib/supabase/client";

type R = Record<string, string>;
export type BuilderTexts = {
  add: string; empty: string; remove: string; up: string; down: string; saveDraft: string; publish: string; submit: string;
  preview: string; unsaved: string; types: R; result: R;
  f: {
    title: string; titleOther: string; body: string; bodyOther: string; style: string; styles: R; height: string; heights: R;
    slides: string; addSlide: string; uploading: string; alt: string; link: string; linkKinds: R; pathHint: string; searchHint: string;
    source: string; sources: R; collection: string; pick: string; limit: string; findProduct: string; noRx: string;
    items: string; addItem: string; label: string; image: string; imageSize: string;
    addTextSlide: string; slideTitle: string; subtitle: string; cta: string; tone: string; tones: R;
    icon: string; noIcon: string; icons: R; imageGuideTitle: string; imageGuide: string;
    look: string; devices: string; deviceNames: R; devicesHint: string; band: string; bands: R; divider: string; dividers: R;
    display: string; displays: Record<string, R>; size: string; sizes: R; shape: string; shapes: R;
    tabs: string; addTab: string; tabTitle: string; tabLook: string; tabLooks: R;
  };
};
type Col = { id: string; slug: string; title: string };
type Hit = { product_id: string; name_fa: string; dispensing_class: string };

// Drag-and-drop page builder. Everything is checked again by the database on
// save, so a crafted request cannot bypass the rules shown here.
export function PageBuilder({ pharmacy, initial, allowed, maxBlocks, maxSlides, needsApproval, collections, productNames, previewHref, texts }: {
  pharmacy: string | null;
  initial: Block[];
  allowed: BlockType[];
  maxBlocks: number;
  maxSlides: number;
  needsApproval: boolean;
  collections: Col[];
  productNames: R;
  previewHref: string;
  texts: BuilderTexts;
}) {
  const T = texts, F = texts.f;
  const [blocks, setBlocks] = useState<Block[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [names, setNames] = useState<R>(productNames);
  const [pending, start] = useTransition();
  const folder = pharmacy ?? "home";

  const set = (fn: (b: Block[]) => Block[]) => { setBlocks(fn); setDirty(true); setMsg(null); };
  const patch = (i: number, p: Partial<Block>) => set((bs) => bs.map((b, n) => (n === i ? ({ ...b, ...p } as Block) : b)));
  const move = (from: number, to: number) => set((bs) => {
    if (to < 0 || to >= bs.length || from === to) return bs;
    const next = [...bs];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
  });
  const run = (fn: () => Promise<string>, okCodes: string[]) => start(async () => {
    const r = await fn();
    setMsg({ ok: okCodes.includes(r), text: T.result[r] ?? T.result.unknown });
    if (okCodes.includes(r)) setDirty(false);
  });

  // ---------------------------------------------------------------- visual canvas
  const [sel, setSel] = useState<string | null>(blocks[0]?.id ?? null);
  const [over, setOver] = useState<number | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [live, setLive] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const frame = useRef<HTMLIFrameElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(blocks);
  latest.current = blocks;

  // every change is saved as the draft a moment later and the preview reloads
  useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLive("saving");
      const r = await savePage(pharmacy, latest.current);
      if (r === "ok") { setLive("saved"); setDirty(false); frame.current?.contentWindow?.location.reload(); }
      else { setLive("error"); setMsg({ ok: false, text: T.result[r] ?? T.result.unknown }); }
    }, 1200);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  const insertAt = (at: number, type: BlockType) => {
    if (blocks.length >= maxBlocks) return;
    const b = emptyBlock(type);
    set((bs) => { const n = [...bs]; n.splice(at, 0, b); return n; });
    setSel(b.id);
  };
  const onDropAt = (at: number, e: React.DragEvent) => {
    e.preventDefault();
    const t = e.dataTransfer.getData("application/x-dorva-block");
    if (t) insertAt(at, t as BlockType);
    else if (drag !== null) move(drag, drag < at ? at - 1 : at);
    setDrag(null); setOver(null);
  };
  const zone = (at: number) => (
    <div key={`z${at}`} onDragOver={(e) => { e.preventDefault(); setOver(at); }} onDragLeave={() => setOver(null)} onDrop={(e) => onDropAt(at, e)}
      className={`rounded-lg border-2 border-dashed transition-all ${over === at ? "h-14 border-brand-500 bg-brand-50" : "h-3 border-transparent"}`} />
  );

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/95 p-3 backdrop-blur">
        <button type="button" className="btn" disabled={pending}
          onClick={() => run(() => publishPage(pharmacy, blocks), ["published", "pending"])}>{needsApproval ? T.submit : T.publish}</button>
        <a href={previewHref} target="_blank" rel="noopener" className="btn-ghost text-sm">{T.preview} ↗</a>
        <span className="text-xs text-muted">{live === "saving" ? "…" : live === "saved" ? `✓ ${T.result.ok ?? ""}` : dirty ? T.unsaved : ""}</span>
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-700"}`}>{msg.text}</span>}
        <div className="ms-auto flex rounded-lg border border-line p-0.5 text-xs">
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} title={F.deviceNames[d]}
              className={`rounded-md px-2 py-1 ${device === d ? "bg-brand-600 text-white" : ""}`}>{F.deviceNames[d]}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)]">
        {/* palette */}
        <aside className="space-y-2 xl:sticky xl:top-20 xl:self-start">
          <p className="text-xs font-bold text-muted">{T.add}</p>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
            {allowed.map((t) => (
              <button key={t} type="button" draggable disabled={blocks.length >= maxBlocks}
                onDragStart={(e) => { e.dataTransfer.setData("application/x-dorva-block", t); e.dataTransfer.effectAllowed = "copy"; }}
                onClick={() => insertAt(blocks.length, t)}
                className="flex cursor-grab items-center gap-2 rounded-xl border border-line bg-white p-2 text-start text-sm hover:border-brand-500 disabled:opacity-40">
                <Thumb type={t} /> <span>{T.types[t]}</span>
              </button>
            ))}
          </div>
          <details className="rounded-xl border border-line bg-white p-2 text-xs">
            <summary className="cursor-pointer font-semibold">{F.imageGuideTitle}</summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted">{F.imageGuide.split("|").map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        </aside>

        {/* canvas */}
        <div className="min-w-0 rounded-2xl border border-line bg-paper p-3">
          {blocks.length === 0 && (
            <div onDragOver={(e) => { e.preventDefault(); setOver(0); }} onDrop={(e) => onDropAt(0, e)}
              className="grid h-40 place-items-center rounded-xl border-2 border-dashed border-line text-sm text-muted">{T.empty}</div>
          )}
          {blocks.length > 0 && zone(0)}
          {blocks.map((b, i) => (
            <div key={b.id}>
              <section
                className={`rounded-xl border-2 bg-white transition ${sel === b.id ? "border-brand-500 shadow-md" : "border-transparent hover:border-line"} ${drag === i ? "opacity-40" : ""}`}>
                <header draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onClick={() => setSel(sel === b.id ? null : b.id)}
                  className="flex cursor-grab items-center gap-2 p-2">
                  <span aria-hidden className="text-muted">⠿</span>
                  <Preview b={b} />
                  <span className="ms-auto flex shrink-0 gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn-ghost px-2 py-1" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={T.up}>↑</button>
                    <button type="button" className="btn-ghost px-2 py-1" disabled={i === blocks.length - 1} onClick={() => move(i, i + 1)} aria-label={T.down}>↓</button>
                    <button type="button" className="btn-ghost px-2 py-1 text-red-700" onClick={() => set((bs) => bs.filter((_, n) => n !== i))} aria-label={T.remove}>×</button>
                  </span>
                </header>
                {sel === b.id && (
                  <div className="space-y-4 border-t border-line p-3">
            <LookEdit b={b} F={F} onChange={(p) => patch(i, p as Partial<Block>)} />
            {b.type === "text" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Sel label={F.style} value={b.style ?? "plain"} options={F.styles} onChange={(v) => patch(i, { style: v as "plain" })} />
                <div />
                <Multi label={F.title} other={F.titleOther} value={b.title} onChange={(v) => patch(i, { title: v })} max={120} />
                <Multi label={F.body} other={F.bodyOther} value={b.body} onChange={(v) => patch(i, { body: v })} max={1500} area />
              </div>
            )}

            {b.type === "banner" && (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Sel label={F.height} value={b.height ?? "m"} options={F.heights} onChange={(v) => patch(i, { height: v as "m" })} />
                  <Sel label={F.shape} value={b.shape ?? "rounded"} options={F.shapes} onChange={(v) => patch(i, { shape: v as "rounded" })} />
                </div>
                <p className="text-xs text-muted">{F.imageSize}</p>
                {b.slides.map((s, n) => {
                  const up = (x: Partial<typeof s>) => patch(i, { slides: b.slides.map((y, k) => (k === n ? { ...y, ...x } : y)) });
                  return (
                    <div key={n} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[10rem_1fr]">
                      {s.image
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={mediaUrl(s.image)} alt="" className="h-24 w-full rounded-lg object-cover" />
                        : <div className={`flex h-24 w-full items-center justify-center rounded-lg bg-gradient-to-l p-2 text-center text-xs font-bold text-white ${(TONES[s.tone ?? "brand"] ?? TONES.brand).slide}`}>{s.title?.fa || F.slideTitle}</div>}
                      <div className="space-y-2">
                        {s.image ? (
                          <Multi label={F.alt} value={s.alt} onChange={(v) => up({ alt: v })} max={120} />
                        ) : (
                          <>
                            <Multi label={F.slideTitle} other={F.titleOther} value={s.title} onChange={(v) => up({ title: v })} max={80} />
                            <Multi label={F.subtitle} other={F.bodyOther} value={s.subtitle} onChange={(v) => up({ subtitle: v })} max={160} />
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Multi label={F.cta} value={s.cta} onChange={(v) => up({ cta: v })} max={30} />
                              <Sel label={F.tone} value={s.tone ?? "brand"} options={F.tones} onChange={(v) => up({ tone: v })} />
                            </div>
                          </>
                        )}
                        <LinkEdit link={s.link} F={F} collections={collections} pharmacy={pharmacy} names={names} setNames={setNames}
                          onChange={(l) => up({ link: l })} />
                        <button type="button" className="text-xs text-red-700 hover:underline"
                          onClick={() => patch(i, { slides: b.slides.filter((_, k) => k !== n) })}>{T.remove}</button>
                      </div>
                    </div>
                  );
                })}
                {b.slides.length < maxSlides && (
                  <div className="flex flex-wrap gap-2">
                    <Upload folder={folder} label={F.addSlide} busy={F.uploading} failText={T.result.upload}
                      onDone={(path) => patch(i, { slides: [...b.slides, { image: path, link: { kind: "none" } }] })} />
                    <button type="button" className="btn-ghost text-sm"
                      onClick={() => patch(i, { slides: [...b.slides, { title: { fa: "" }, tone: "brand", link: { kind: "none" } }] })}>+ {F.addTextSlide}</button>
                  </div>
                )}
              </div>
            )}

            {b.type === "products" && (
              <ProductsEdit b={b} F={F} collections={collections} pharmacy={pharmacy} names={names} setNames={setNames}
                onChange={(p) => patch(i, p)} />
            )}

            {b.type === "tabs" && (
              <TabsEdit b={b} F={F} collections={collections} pharmacy={pharmacy} names={names} setNames={setNames}
                onChange={(p) => patch(i, p)} />
            )}

            {(b.type === "categories" || b.type === "features") && (
              <div className="space-y-3">
                <Multi label={F.title} other={F.titleOther} value={b.title} onChange={(v) => patch(i, { title: v })} max={120} />
                {b.items.map((it, n) => {
                  const up = (x: Partial<TileItem>) => patch(i, { items: b.items.map((y, k) => (k === n ? { ...y, ...x } : y)) });
                  return (
                    <div key={n} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[6rem_1fr]">
                      <div className="space-y-1">
                        {it.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={mediaUrl(it.image)} alt="" className="aspect-square w-full rounded-lg object-cover" />
                          : <div className={`flex aspect-square w-full items-center justify-center rounded-lg ${(TONES[it.tone ?? "brand"] ?? TONES.brand).tile}`}>
                              {it.icon ? <Icon name={it.icon} className="h-1/2 w-1/2" /> : <span className="text-xl font-bold">{(it.label?.fa ?? "").slice(0, 1)}</span>}
                            </div>}
                        {b.type === "categories" && (
                          <Upload folder={folder} label={F.image} busy={F.uploading} failText={T.result.upload} small onDone={(path) => up({ image: path })} />
                        )}
                        {it.image && <button type="button" className="w-full text-xs text-red-700" onClick={() => up({ image: undefined })}>× {F.image}</button>}
                      </div>
                      <div className="space-y-2">
                        <Multi label={F.label} other={F.titleOther} value={it.label} onChange={(v) => up({ label: v ?? {} })} max={60} />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block text-sm"><span className="label">{F.icon}</span>
                            <select className="input" value={it.icon ?? ""} onChange={(e) => up({ icon: e.target.value || undefined })}>
                              <option value="">{F.noIcon}</option>
                              {ICON_NAMES.map((k) => <option key={k} value={k}>{F.icons[k] ?? k}</option>)}
                            </select>
                          </label>
                          <label className="block text-sm"><span className="label">{F.tone}</span>
                            <select className="input" value={it.tone ?? "brand"} onChange={(e) => up({ tone: e.target.value })}>
                              {TONE_NAMES.map((k) => <option key={k} value={k}>{F.tones[k] ?? k}</option>)}
                            </select>
                          </label>
                        </div>
                        <LinkEdit link={it.link} F={F} collections={collections} pharmacy={pharmacy} names={names} setNames={setNames}
                          onChange={(l) => up({ link: l })} />
                        <button type="button" className="text-xs text-red-700 hover:underline"
                          onClick={() => patch(i, { items: b.items.filter((_, k) => k !== n) })}>{T.remove}</button>
                      </div>
                    </div>
                  );
                })}
                {b.items.length < 12 && (
                  <button type="button" className="btn-ghost text-sm"
                    onClick={() => patch(i, { items: [...b.items, { label: { fa: "" }, icon: b.type === "features" ? "shield" : undefined, tone: "brand", link: { kind: "none" } }] })}>+ {F.addItem}</button>
                )}
              </div>
            )}
                  </div>
                )}
              </section>
              {zone(i + 1)}
            </div>
          ))}
        </div>

        {/* live preview of the saved draft */}
        <div className="hidden min-w-0 xl:block">
          <div className="sticky top-20 flex justify-center rounded-2xl border border-line bg-slate-100 p-2">
            <iframe ref={frame} src={previewHref} title={T.preview} className="h-[78vh] rounded-xl bg-white shadow"
              style={{ width: device === "mobile" ? 390 : device === "tablet" ? 820 : "100%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// small pictogram of a block type for the palette
function Thumb({ type }: { type: BlockType }) {
  const box = "h-8 w-10 shrink-0 rounded-md bg-brand-50 p-1";
  if (type === "banner") return <span className={`${box} grid`}><span className="rounded bg-gradient-to-l from-brand-600 to-brand-400" /></span>;
  if (type === "features") return <span className={`${box} flex items-center justify-around`}>{[0, 1, 2].map((k) => <span key={k} className="h-2.5 w-2.5 rounded-full bg-brand-500" />)}</span>;
  if (type === "categories") return <span className={`${box} grid grid-cols-3 gap-0.5`}>{[0, 1, 2, 3, 4, 5].map((k) => <span key={k} className="rounded-sm bg-brand-400" />)}</span>;
  if (type === "tabs") return <span className={`${box} space-y-0.5`}><span className="flex gap-0.5">{[0, 1, 2].map((k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k ? "bg-brand-200" : "bg-brand-600"}`} />)}</span><span className="flex gap-0.5">{[0, 1, 2].map((k) => <span key={k} className="h-3.5 flex-1 rounded-sm border border-brand-400 bg-white" />)}</span></span>;
  if (type === "products") return <span className={`${box} flex gap-0.5`}>{[0, 1, 2].map((k) => <span key={k} className="flex-1 rounded-sm border border-brand-400 bg-white" />)}</span>;
  return <span className={`${box} space-y-1`}><span className="block h-1 w-3/4 rounded bg-brand-500" /><span className="block h-1 rounded bg-brand-200" /><span className="block h-1 w-2/3 rounded bg-brand-200" /></span>;
}

// a visual, true-to-type miniature of one block on the canvas
function Preview({ b }: { b: Block }) {
  const t = (v?: I18nText) => v?.fa || "";
  if (b.type === "banner") {
    const s = b.slides[0];
    return (
      <div className={`relative flex min-w-0 flex-1 items-center overflow-hidden rounded-lg ${b.height === "s" ? "h-14" : b.height === "l" ? "h-24" : "h-20"}`}>
        {s?.image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={mediaUrl(s.image)} alt="" className="absolute inset-0 h-full w-full object-cover" />
          : <div className={`absolute inset-0 bg-gradient-to-l ${(TONES[s?.tone ?? "brand"] ?? TONES.brand).slide}`} />}
        <span className="relative px-3 text-sm font-bold text-white drop-shadow">{t(s?.title)}</span>
        {b.slides.length > 1 && <span className="absolute bottom-1 start-2 flex gap-1">{b.slides.map((_, k) => <span key={k} className="h-1.5 w-1.5 rounded-full bg-white/80" />)}</span>}
      </div>
    );
  }
  if (b.type === "features" || b.type === "categories") {
    return (
      <div className="min-w-0 flex-1">
        {t(b.title) && <p className="mb-1 text-xs font-bold">{t(b.title)}</p>}
        <div className={`grid gap-1 ${b.type === "features" ? "grid-cols-6" : "grid-cols-6"}`}>
          {b.items.slice(0, 6).map((it, k) => (
            <span key={k} className="flex flex-col items-center gap-0.5 text-center">
              {it.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={mediaUrl(it.image)} alt="" className="h-8 w-8 rounded-md object-cover" />
                : <span className={`grid h-8 w-8 place-items-center rounded-md ${(TONES[it.tone ?? "brand"] ?? TONES.brand).tile}`}>{it.icon ? <Icon name={it.icon} className="h-4 w-4" /> : null}</span>}
              <span className="line-clamp-1 text-[10px]">{t(it.label)}</span>
            </span>
          ))}
          {b.items.length === 0 && <span className="col-span-6 h-8 rounded-md border border-dashed border-line" />}
        </div>
      </div>
    );
  }
  if (b.type === "tabs") {
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex gap-1">{b.tabs.map((x, k) => <span key={k} className={`rounded-full px-2 text-[10px] ${k ? "bg-brand-50" : "bg-brand-600 text-white"}`}>{t(x.title) || "…"}</span>)}</div>
        <div className="flex gap-1">{[0, 1, 2, 3, 4].map((k) => <span key={k} className="h-8 flex-1 rounded-md border border-line" />)}</div>
      </div>
    );
  }
  if (b.type === "products") {
    return (
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-bold">{t(b.title) || "…"}</p>
        <div className="flex gap-1">{[0, 1, 2, 3, 4].map((k) => (
          <span key={k} className="flex-1 space-y-0.5 rounded-md border border-line p-1"><span className="block aspect-square rounded bg-slate-100" /><span className="block h-1 rounded bg-slate-200" /></span>
        ))}</div>
      </div>
    );
  }
  return (
    <div className={`min-w-0 flex-1 rounded-lg p-2 text-xs ${b.style === "notice" ? "bg-amber-50" : b.style === "info" ? "bg-brand-50" : ""}`}>
      <p className="font-bold">{t(b.title)}</p>
      <p className="line-clamp-2 text-muted">{t(b.body)}</p>
    </div>
  );
}

function Sel({ label, value, options, onChange }: { label: string; value: string; options: R; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}

// Persian first; English and Arabic folded away
function Multi({ label, other, value, onChange, max, area }: {
  label: string; other?: string; value: I18nText | undefined; onChange: (v: I18nText) => void; max: number; area?: boolean;
}) {
  const v = value ?? {};
  const field = (k: keyof I18nText, dir: "rtl" | "ltr") => {
    const props = { className: "input", dir, maxLength: max, value: v[k] ?? "", onChange: (e: { target: { value: string } }) => onChange({ ...v, [k]: e.target.value }) };
    return area ? <textarea rows={3} {...props} /> : <input {...props} />;
  };
  return (
    <div className={`text-sm ${area ? "sm:col-span-2" : ""}`}>
      <span className="label">{label}</span>
      {field("fa", "rtl")}
      {other && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted">{other}</summary>
          <div className="mt-1 space-y-1">{field("en", "ltr")}{field("ar", "rtl")}</div>
        </details>
      )}
    </div>
  );
}

function Upload({ folder, label, busy, failText, onDone, small }: {
  folder: string; label: string; busy: string; failText: string; onDone: (path: string) => void; small?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "fail">("idle");
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as R)[file.type];
    if (!ext || file.size > 2 * 1024 * 1024) { setState("fail"); return; }
    setState("busy");
    const path = `${folder}/${newId()}${newId()}.${ext}`;
    const { error } = await createClient().storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setState("fail"); return; }
    setState("idle");
    onDone(path);
    if (ref.current) ref.current.value = "";
  };
  return (
    <div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className={`btn-ghost ${small ? "w-full px-2 py-1 text-xs" : "text-sm"}`} disabled={state === "busy"}
        onClick={() => ref.current?.click()}>{state === "busy" ? busy : `+ ${label}`}</button>
      {state === "fail" && <p className="mt-1 text-xs text-red-700">{failText}</p>}
    </div>
  );
}

function ProductSearch({ pharmacy, F, onPick }: { pharmacy: string | null; F: BuilderTexts["f"]; onPick: (h: Hit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await createClient().rpc("shop_search", { p_query: v.trim(), p_pharmacy: pharmacy, p_limit: 8 });
      setHits((data as Hit[] | null) ?? []);
    }, 300);
  };
  return (
    <div className="text-sm">
      <input className="input" type="search" placeholder={F.findProduct} value={q} onChange={(e) => search(e.target.value)} />
      {hits.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-line">
          {hits.map((h) => (
            <li key={h.product_id}>
              <button type="button" disabled={h.dispensing_class === "rx"}
                className="w-full px-3 py-2 text-start hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-muted"
                onClick={() => { onPick(h); setQ(""); setHits([]); }}>
                {h.name_fa}{h.dispensing_class === "rx" && <span className="ms-2 text-xs">({F.noRx})</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkEdit({ link, F, collections, pharmacy, names, setNames, onChange }: {
  link: PageLink | undefined; F: BuilderTexts["f"]; collections: Col[]; pharmacy: string | null;
  names: R; setNames: (fn: (n: R) => R) => void; onChange: (l: PageLink) => void;
}) {
  const l = link ?? { kind: "none" as const };
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
      <label><span className="label">{F.link}</span>
        <select className="input" value={l.kind} onChange={(e) => onChange({ kind: e.target.value as PageLink["kind"], value: "" })}>
          {Object.entries(F.linkKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <div className="self-end">
        {l.kind === "collection" && (
          <select className="input" value={l.value ?? ""} onChange={(e) => onChange({ kind: "collection", value: e.target.value })}>
            <option value="">{F.pick}</option>
            {collections.map((c) => <option key={c.id} value={c.slug}>{c.title}</option>)}
          </select>
        )}
        {(l.kind === "search" || l.kind === "path") && (
          <input className="input" dir={l.kind === "path" ? "ltr" : undefined} maxLength={l.kind === "path" ? 150 : 60}
            placeholder={l.kind === "path" ? F.pathHint : F.searchHint} value={l.value ?? ""}
            onChange={(e) => onChange({ kind: l.kind, value: e.target.value })} />
        )}
        {l.kind === "product" && (l.value
          ? <p className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <span className="truncate">{names[l.value] ?? l.value}</span>
              <button type="button" className="text-xs text-red-700" onClick={() => onChange({ kind: "product", value: "" })}>×</button>
            </p>
          : <ProductSearch pharmacy={pharmacy} F={F} onPick={(h) => { setNames((n) => ({ ...n, [h.product_id]: h.name_fa })); onChange({ kind: "product", value: h.product_id }); }} />)}
      </div>
    </div>
  );
}

function ProductsEdit({ b, F, collections, pharmacy, names, setNames, onChange }: {
  b: ProductsBlock; F: BuilderTexts["f"]; collections: Col[]; pharmacy: string | null;
  names: R; setNames: (fn: (n: R) => R) => void; onChange: (p: Partial<ProductsBlock>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Multi label={F.title} other={F.titleOther} value={b.title} onChange={(v) => onChange({ title: v })} max={120} />
      <label className="block text-sm"><span className="label">{F.limit}</span>
        <input className="input" type="number" min={4} max={24} value={b.limit ?? 12}
          onChange={(e) => onChange({ limit: Math.min(24, Math.max(4, Number(e.target.value) || 12)) })} />
      </label>
      <SourceEdit src={b} F={F} collections={collections} pharmacy={pharmacy} names={names} setNames={setNames} onChange={onChange} />
    </div>
  );
}

// where a product list comes from: best sellers, discounts, newest, a collection or hand-picked
function SourceEdit({ src, F, collections, pharmacy, names, setNames, onChange }: {
  src: ProductSource; F: BuilderTexts["f"]; collections: Col[]; pharmacy: string | null;
  names: R; setNames: (fn: (n: R) => R) => void; onChange: (p: Partial<ProductSource>) => void;
}) {
  const ids = src.products ?? [];
  return (
    <>
      <Sel label={F.source} value={src.source} options={F.sources} onChange={(v) => onChange({ source: v as ProductSource["source"] })} />
      {src.source === "collection" ? (
        <label className="block text-sm"><span className="label">{F.collection}</span>
          <select className="input" value={src.collection ?? ""} onChange={(e) => onChange({ collection: e.target.value })}>
            <option value="">{F.pick}</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      ) : <div />}
      {src.source === "manual" && (
        <div className="space-y-2 sm:col-span-2">
          <ul className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <li key={id} className="chip gap-1">
                {names[id] ?? id.slice(0, 8)}
                <button type="button" aria-label="×" onClick={() => onChange({ products: ids.filter((x) => x !== id) })}>×</button>
              </li>
            ))}
          </ul>
          {ids.length < 24 && (
            <ProductSearch pharmacy={pharmacy} F={F} onPick={(h) => {
              setNames((n) => ({ ...n, [h.product_id]: h.name_fa }));
              if (!ids.includes(h.product_id)) onChange({ products: [...ids, h.product_id] });
            }} />
          )}
        </div>
      )}
    </>
  );
}

function TabsEdit({ b, F, collections, pharmacy, names, setNames, onChange }: {
  b: TabsBlock; F: BuilderTexts["f"]; collections: Col[]; pharmacy: string | null;
  names: R; setNames: (fn: (n: R) => R) => void; onChange: (p: Partial<TabsBlock>) => void;
}) {
  const up = (n: number, x: Partial<TabsBlock["tabs"][number]>) => onChange({ tabs: b.tabs.map((t, k) => (k === n ? { ...t, ...x } : t)) });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Multi label={F.title} other={F.titleOther} value={b.title} onChange={(v) => onChange({ title: v })} max={120} />
        <Sel label={F.tabLook} value={b.look ?? "pills"} options={F.tabLooks} onChange={(v) => onChange({ look: v as "pills" })} />
        <label className="block text-sm"><span className="label">{F.limit}</span>
          <input className="input" type="number" min={4} max={24} value={b.limit ?? 12}
            onChange={(e) => onChange({ limit: Math.min(24, Math.max(4, Number(e.target.value) || 12)) })} />
        </label>
      </div>
      <p className="text-xs font-bold text-muted">{F.tabs}</p>
      {b.tabs.map((t, n) => (
        <div key={n} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2">
          <Multi label={F.tabTitle} other={F.titleOther} value={t.title} onChange={(v) => up(n, { title: v ?? {} })} max={40} />
          <div className="flex items-end justify-end">
            {b.tabs.length > 2 && <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => onChange({ tabs: b.tabs.filter((_, k) => k !== n) })}>× {F.tabTitle}</button>}
          </div>
          <SourceEdit src={t} F={F} collections={collections} pharmacy={pharmacy} names={names} setNames={setNames} onChange={(x) => up(n, x)} />
        </div>
      ))}
      {b.tabs.length < 5 && (
        <button type="button" className="btn-ghost text-sm"
          onClick={() => onChange({ tabs: [...b.tabs, { title: { fa: "" }, source: "newest" }] })}>+ {F.addTab}</button>
      )}
    </div>
  );
}

// options every block has (devices, band, edge) plus this type's display and size
function LookEdit({ b, F, onChange }: { b: Block; F: BuilderTexts["f"]; onChange: (p: Partial<BlockLook> & { display?: string; size?: string }) => void }) {
  const devices = b.devices?.length ? b.devices : DEVICES;
  const toggle = (d: Device) => {
    const next = devices.includes(d) ? devices.filter((x) => x !== d) : [...devices, d];
    if (next.length) onChange({ devices: next.length === 3 ? undefined : DEVICES.filter((x) => next.includes(x)) });
  };
  const displays = DISPLAYS[b.type];
  const display = (b as { display?: string }).display;
  const hasSize = b.type === "categories" || b.type === "features";
  return (
    <details className="rounded-xl bg-paper p-3 text-sm" open={!!(b.devices || (b.band && b.band !== "none"))}>
      <summary className="cursor-pointer font-semibold">{F.look}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <span className="label">{F.devices}</span>
          <div className="flex flex-wrap gap-2">
            {DEVICES.map((d) => (
              <label key={d} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 ${devices.includes(d) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-white"}`}>
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={devices.includes(d)} onChange={() => toggle(d)} /> {F.deviceNames[d]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{F.devicesHint}</p>
        </div>
        {displays && (
          <label className="block"><span className="label">{F.display}</span>
            <select className="input" value={display ?? displays[0]} onChange={(e) => onChange({ display: e.target.value })}>
              {displays.map((k) => <option key={k} value={k}>{F.displays[b.type]?.[k] ?? k}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className="label">{F.band}</span>
          <select className="input" value={b.band ?? "none"} onChange={(e) => onChange({ band: e.target.value as BlockLook["band"] })}>
            {BANDS.map((k) => <option key={k} value={k}>{F.bands[k] ?? k}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">{F.divider}</span>
          <select className="input" value={b.divider ?? "none"} onChange={(e) => onChange({ divider: e.target.value as BlockLook["divider"] })}>
            {DIVIDERS.map((k) => <option key={k} value={k}>{F.dividers[k] ?? k}</option>)}
          </select>
        </label>
        {hasSize && (
          <label className="block"><span className="label">{F.size}</span>
            <select className="input" value={(b as { size?: string }).size ?? "m"} onChange={(e) => onChange({ size: e.target.value })}>
              {Object.entries(F.sizes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
      </div>
    </details>
  );
}
