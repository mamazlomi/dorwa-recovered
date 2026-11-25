"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { StudioTexts } from "@/i18n/dictionaries/studio";
import { MEDIA_BUCKET, mediaUrl, newId } from "@/lib/pageBlocks";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULTS, RULES, diffTheme, getPath, isCssOnly, resolveTheme, setPath, themeAttrs, themeCss, valid,
  type I18n, type Rule, type ThemeConfig,
} from "@/lib/themeConfig";
import { discardThemeDraft, publishTheme, saveThemeDraft, startThemePreview, stopThemePreview } from "@/lib/themeActions";

type Section = { key: string; prefixes: string[]; page?: string };
const SECTIONS: Section[] = [
  { key: "colors", prefixes: ["colors.", "mode"] },
  { key: "type", prefixes: ["font."] },
  { key: "shape", prefixes: ["shape.", "layout."] },
  { key: "logo", prefixes: ["logo."] },
  { key: "header", prefixes: ["header."] },
  { key: "footer", prefixes: ["footer."] },
  { key: "card", prefixes: ["card."], page: "products" },
  { key: "lists", prefixes: ["grid.", "rows."], page: "products" },
  { key: "product", prefixes: ["product."], page: "product" },
  { key: "pages", prefixes: ["pharmacy.", "cart."], page: "pharmacy" },
  { key: "extras", prefixes: ["extras.", "app."] },
];
const PATHS = Object.keys(RULES);
const pathsOf = (s: Section) => PATHS.filter((p) => s.prefixes.some((x) => p === x || (x.endsWith(".") && p.startsWith(x))));
// switched by html data-* attributes, so they can also be shown without a reload
const ATTR_KEYS = ["mode", "shape.button", "layout.background", "font.body", "font.heading"];
const isLive = (p: string) => isCssOnly(p) || ATTR_KEYS.includes(p);
const WIDTH = { desktop: "100%", tablet: "820px", mobile: "390px" } as const;
type Device = keyof typeof WIDTH;

export function ThemeStudio({ locale, id, initialName, stored, isLive: live, pages, texts: S }: {
  locale: string; id: string; initialName: string; stored: unknown; isLive: boolean;
  pages: Record<string, string>; texts: StudioTexts;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ThemeConfig>(() => resolveTheme(stored));
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [page, setPage] = useState("home");
  const [open, setOpen] = useState("colors");
  const [ready, setReady] = useState(false);
  const [pane, setPane] = useState<"controls" | "preview">("controls");
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(cfg);
  const nameRef = useRef(name);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useRef(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const push = (c: ThemeConfig) =>
    frame.current?.contentWindow?.postMessage({ type: "dorva-theme", css: themeCss(c), attrs: themeAttrs(c) }, origin);

  useEffect(() => { startThemePreview(id).then(() => setReady(true)); }, [id]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin === window.location.origin && (e.data as { type?: string } | null)?.type === "dorva-frame-ready") push(latest.current);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveNow = async (): Promise<string> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setStatus("saving");
    const r = await saveThemeDraft(id, nameRef.current.trim() || null, diffTheme(latest.current));
    if (r === "ok") {
      setStatus("saved"); setNote(null);
      if (reload.current) { reload.current = false; frame.current?.contentWindow?.location.reload(); }
    } else {
      setStatus("error");
      setNote(S.result[r] ?? `${S.result.unknown} (${r})`);
    }
    return r;
  };
  const queueSave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveNow(); }, 600);
  };
  const change = (path: string, v: unknown) => {
    const next = setPath(latest.current, path, v);
    latest.current = next;
    setCfg(next);
    if (isLive(path)) push(next); else reload.current = true;
    queueSave();
  };
  const resetSection = (s: Section) => {
    if (!window.confirm(`${S.resetSection}: ${S.sections[s.key]}?`)) return;
    let next = latest.current;
    pathsOf(s).forEach((p) => { next = setPath(next, p, getPath(DEFAULTS, p)); });
    latest.current = next; setCfg(next); push(next); reload.current = true; queueSave();
  };
  const publish = async () => {
    setBusy(true);
    const r = await saveNow();
    if (r === "ok") {
      const p = await publishTheme(id);
      setNote(p === "ok" || p === "published" ? S.publishDone : S.result[p] ?? S.result.unknown);
      if (p === "ok" || p === "published") setStatus("idle");
    }
    setBusy(false);
  };
  const discard = async () => {
    if (!window.confirm(`${S.discard}?`)) return;
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    await discardThemeDraft(id);
    window.location.reload();
  };
  const exit = async () => {
    setBusy(true);
    if (timer.current) await saveNow();
    await stopThemePreview();
    router.push(`/${locale}/admin/theme`);
  };
  const openSection = (s: Section) => {
    setOpen(open === s.key ? "" : s.key);
    if (s.page && pages[s.page] && open !== s.key) setPage(s.page);
  };

  const shown = (p: string) => {
    if (p === "logo.image") return cfg.logo.mode !== "text";
    if (p === "logo.text") return cfg.logo.mode !== "image";
    if (p.startsWith("header.announce.") && p !== "header.announce.on") return cfg.header.announce.on;
    return true;
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper text-ink">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <button type="button" onClick={exit} disabled={busy} className="btn-ghost text-sm">‹ {S.back}</button>
        <input value={name} maxLength={60} aria-label={S.name} className="input w-48 py-1 text-sm font-bold"
          onChange={(e) => { setName(e.target.value); nameRef.current = e.target.value; queueSave(); }} />
        <span className={`text-xs ${status === "error" ? "text-red-700" : "text-muted"}`} role="status">
          {status === "saving" ? S.saving : status === "saved" ? `✓ ${S.saved}` : status === "error" ? S.saveError : ""}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-xs" role="group">
            {(Object.keys(WIDTH) as Device[]).map((d) => (
              <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d}
                className={`rounded-md px-2 py-1 ${device === d ? "bg-brand-600 text-white" : ""}`}>{S.device[d]}</button>
            ))}
          </div>
          <select value={page} onChange={(e) => setPage(e.target.value)} className="input w-auto py-1 text-xs" aria-label="page">
            {Object.keys(pages).map((p) => <option key={p} value={p}>{S.page[p] ?? p}</option>)}
          </select>
          <button type="button" onClick={discard} disabled={busy} className="btn-ghost text-xs">{S.discard}</button>
          <button type="button" onClick={publish} disabled={busy} className="btn text-sm">{S.publish}</button>
        </div>
      </div>
      {note && <p role="status" className="bg-brand-50 px-4 py-2 text-sm text-brand-700">{note}</p>}

      {/* small screens: switch between controls and preview */}
      <div className="flex border-b border-line bg-surface text-sm lg:hidden">
        {(["controls", "preview"] as const).map((p) => (
          <button key={p} type="button" onClick={() => setPane(p)}
            className={`flex-1 py-2 ${pane === p ? "border-b-2 border-brand-600 font-bold" : ""}`}>
            {p === "controls" ? S.title : S.preview}</button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* controls */}
        <aside className={`${pane === "controls" ? "block" : "hidden"} w-full overflow-y-auto border-e border-line bg-surface lg:block lg:w-[380px] lg:shrink-0`}>
          <p className="px-4 pt-3 text-xs text-muted">{live ? S.liveNote : S.notLiveNote}</p>
          {SECTIONS.map((s) => (
            <section key={s.key} className="border-b border-line">
              <button type="button" onClick={() => openSection(s)} aria-expanded={open === s.key}
                className="flex w-full items-center justify-between px-4 py-3 text-start font-bold hover:bg-brand-50">
                {S.sections[s.key]}<span aria-hidden className={`transition ${open === s.key ? "rotate-90" : ""}`}>›</span>
              </button>
              {open === s.key && (
                <div className="space-y-4 px-4 pb-4">
                  {pathsOf(s).filter(shown).map((p) => (
                    <Field key={p} path={p} rule={RULES[p]} value={getPath(cfg, p)} S={S} onChange={(v) => change(p, v)} />
                  ))}
                  <button type="button" onClick={() => resetSection(s)} className="text-xs text-muted underline">{S.resetSection}</button>
                </div>
              )}
            </section>
          ))}
        </aside>

        {/* preview */}
        <div className={`${pane === "preview" ? "flex" : "hidden"} min-w-0 flex-1 justify-center overflow-auto bg-slate-200/70 p-3 lg:flex`}>
          {ready ? (
            <iframe ref={frame} key={page} src={pages[page] ?? pages.home} title={S.preview}
              onLoad={() => push(latest.current)}
              className="h-full rounded-xl border border-line bg-white shadow-lg transition-[width]"
              style={{ width: WIDTH[device], maxWidth: "100%" }} />
          ) : <p className="self-center text-sm text-muted">…</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one control
function Field({ path, rule, value, S, onChange }: {
  path: string; rule: Rule; value: unknown; S: StudioTexts; onChange: (v: unknown) => void;
}) {
  const label = S.labels[path] ?? path;
  const id = `f-${path.replace(/\./g, "-")}`;
  const bad = !valid(path, value);

  switch (rule.t) {
    case "color": {
      const v = String(value ?? "");
      return (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={id} className="text-sm">{label}</label>
          <div className="flex items-center gap-2">
            <input id={id} type="color" value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : "#000000"} onChange={(e) => onChange(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" />
            <input dir="ltr" value={v} maxLength={7} aria-label={label} onChange={(e) => onChange(e.target.value)}
              className={`input w-24 py-1 font-mono text-xs ${bad ? "border-red-500" : ""}`} />
          </div>
        </div>
      );
    }
    case "bool":
      return (
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          {label}
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-brand-600" />
        </label>
      );
    case "enum": {
      const opts = S.options[path] ?? {};
      return (
        <div>
          <span className="label">{label}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
            {rule.v.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${value === o ? "border-brand-600 bg-brand-600 text-white" : "border-line hover:bg-brand-50"}`}>
                {opts[o] ?? o}</button>
            ))}
          </div>
        </div>
      );
    }
    case "num": {
      const n = typeof value === "number" ? value : rule.min;
      return (
        <div>
          <label htmlFor={id} className="label flex justify-between"><span>{label}</span><b dir="ltr">{n}</b></label>
          <input id={id} type="range" min={rule.min} max={rule.max} step={rule.max - rule.min > 100 ? 8 : 1} value={n}
            onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-600" />
        </div>
      );
    }
    case "text": case "path": case "url": {
      const ltr = rule.t !== "text" || /phone|email/.test(path);
      return (
        <div>
          <label htmlFor={id} className="label">{label}</label>
          <input id={id} dir={ltr ? "ltr" : undefined} value={String(value ?? "")} maxLength={rule.t === "text" ? rule.max : 200}
            onChange={(e) => onChange(e.target.value)} className={`input text-sm ${bad ? "border-red-500" : ""}`}
            placeholder={rule.t === "url" ? "https://" : rule.t === "path" ? "/products" : undefined} />
        </div>
      );
    }
    case "i18n": {
      const v = (value ?? {}) as I18n;
      const set = (k: keyof I18n, x: string) => { const n = { ...v, [k]: x }; if (!x) delete n[k]; onChange(n); };
      const long = rule.max > 120;
      const input = (k: keyof I18n, dir: "rtl" | "ltr") => long
        ? <textarea dir={dir} rows={3} maxLength={rule.max} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="input text-sm" aria-label={`${label} ${k}`} />
        : <input dir={dir} maxLength={rule.max} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="input text-sm" aria-label={`${label} ${k}`} />;
      return (
        <div>
          <span className="label">{label}</span>
          {input("fa", "rtl")}
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted">{S.otherLangs}</summary>
            <div className="mt-1 space-y-1">{input("en", "ltr")}{input("ar", "rtl")}</div>
          </details>
        </div>
      );
    }
    case "image":
      return (
        <div>
          <span className="label">{label}</span>
          <ImagePick folder="theme" value={String(value ?? "")} S={S} onChange={onChange} />
        </div>
      );
  }
}

export function ImagePick({ folder, value, S, onChange, square }: {
  folder: string; value: string; S: StudioTexts; onChange: (v: string) => void; square?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "fail">("idle");
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
    if (!ext || file.size > 2 * 1024 * 1024) { setState("fail"); return; }
    setState("busy");
    const path = `${folder}/${newId()}${newId()}.${ext}`;
    const { error } = await createClient().storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setState("fail"); return; }
    setState("idle");
    onChange(path);
    if (ref.current) ref.current.value = "";
  };
  return (
    <div className="space-y-2">
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl(value)} alt="" className={`${square ? "h-20 w-20" : "h-20 w-full"} rounded-lg border border-line bg-white object-contain`} />
      )}
      <div className="flex gap-2">
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn-ghost text-xs" disabled={state === "busy"} onClick={() => ref.current?.click()}>
          {state === "busy" ? S.uploading : `+ ${S.upload}`}</button>
        {value && <button type="button" className="btn-ghost text-xs text-red-700" onClick={() => onChange("")}>{S.clear}</button>}
      </div>
      {state === "fail" && <p className="text-xs text-red-700">{S.uploadFail}</p>}
    </div>
  );
}
