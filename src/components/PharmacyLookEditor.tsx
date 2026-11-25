"use client";

import { useState, useTransition } from "react";
import { ImagePick } from "@/components/ThemeStudio";
import type { StudioTexts } from "@/i18n/dictionaries/studio";
import { mediaUrl } from "@/lib/pageBlocks";
import { savePharmacyLook } from "@/lib/themeActions";

type Look = { accent?: string; logo?: string; cover?: string; coverTone?: string };
const TONES = ["brand", "accent", "dark", "soft"] as const;
const TONE_BG: Record<string, string> = {
  brand: "linear-gradient(120deg,var(--color-brand-700),var(--color-brand-400))",
  accent: "linear-gradient(120deg,var(--color-accent-700),var(--color-brand-400))",
  dark: "linear-gradient(120deg,#0f172a,#334155)",
  soft: "linear-gradient(120deg,var(--color-brand-100),var(--color-brand-50))",
};

export function PharmacyLookEditor({ pharmacy, name, initial, needsApproval, previewHref, texts: S }: {
  pharmacy: string; name: string; initial: Look; needsApproval: boolean; previewHref: string; texts: StudioTexts;
}) {
  const [look, setLook] = useState<Look>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Look, v: string) => { const n = { ...look, [k]: v }; if (!v) delete n[k]; setLook(n); setMsg(null); };
  const save = (submit: boolean) => start(async () => {
    const r = await savePharmacyLook(pharmacy, look, submit);
    setMsg(r === "ok" ? S.saved : S.result[r] ?? S.result[r.split(":")[0]] ?? S.result.unknown);
  });
  const accent = look.accent && /^#[0-9a-fA-F]{6}$/.test(look.accent) ? look.accent : "#0e76a8";
  const coverBg = look.cover ? `center/cover no-repeat url(${mediaUrl(look.cover)})` : TONE_BG[look.coverTone ?? "brand"];

  return (
    <div className="space-y-5">
      {/* live preview of the page header */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="h-32 sm:h-40" style={{ background: coverBg }} />
        <div className="flex items-center gap-3 p-4">
          {look.logo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={mediaUrl(look.logo)} alt="" className="-mt-10 h-16 w-16 rounded-xl border-4 border-surface bg-white object-cover" />
            : <span className="-mt-10 grid h-16 w-16 place-items-center rounded-xl border-4 border-surface bg-brand-50 text-2xl font-bold" style={{ color: accent }}>{name.slice(0, 1)}</span>}
          <b className="text-lg" style={{ color: accent }}>{name}</b>
        </div>
      </div>

      <div className="card space-y-5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="ph-accent" className="text-sm">{S.accent}</label>
          <div className="flex items-center gap-2">
            <input id="ph-accent" type="color" value={accent} onChange={(e) => set("accent", e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-line" />
            {look.accent && <button type="button" className="text-xs text-muted underline" onClick={() => set("accent", "")}>{S.clear}</button>}
          </div>
        </div>
        <div><span className="label">{S.logo}</span>
          <ImagePick folder={pharmacy} value={look.logo ?? ""} S={S} square onChange={(v) => set("logo", v)} /></div>
        <div><span className="label">{S.cover}</span>
          <ImagePick folder={pharmacy} value={look.cover ?? ""} S={S} onChange={(v) => set("cover", v)} /></div>
        <div>
          <span className="label">{S.coverTone}</span>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button key={t} type="button" onClick={() => set("coverTone", t)} aria-pressed={(look.coverTone ?? "brand") === t}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs ${(look.coverTone ?? "brand") === t ? "border-brand-600 ring-2 ring-brand-200" : "border-line"}`}>
                <span className="h-4 w-6 rounded" style={{ background: TONE_BG[t] }} />{S.coverTones[t]}</button>
            ))}
          </div>
        </div>
      </div>

      {msg && <p role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => save(false)}>{S.saveDraft}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => save(true)}>{needsApproval ? S.submit : S.publishNow}</button>
        <a href={previewHref} target="_blank" rel="noreferrer" className="btn-ghost">{S.preview} ↗</a>
      </div>
    </div>
  );
}
