"use client";

import { useState, useTransition } from "react";
import { MapPicker } from "@/components/MapPicker";
import type { ProfileTexts } from "@/i18n/dictionaries/profile";
import { mediaUrl, MEDIA_BUCKET, newId } from "@/lib/pageBlocks";
import { cancelProfileChange, saveMyOfficerProfile, savePharmacyProfile, uploadResume, writeAbout, writeOfficerBio } from "@/lib/profileActions";
import type { Round6Texts } from "@/i18n/dictionaries/round6";
import type { Round5Texts } from "@/i18n/dictionaries/round5";
import { createClient } from "@/lib/supabase/client";

type Shift = { days: number[]; from: string; to: string };
export type OfficerProfile = {
  degree?: string; specialty?: string; university?: string; grad_year?: string; other_degrees?: string; years_total?: string;
  areas?: Record<string, string>; expertise?: string[]; work_history?: string; achievements?: string; languages?: string;
  consent?: boolean; resume_text?: string;
};
export type Officer = {
  id?: string; full_name: string; council_no?: string | null; photo?: string | null; bio?: string | null; shifts: Shift[];
  profile?: OfficerProfile | null; resume?: string | null; user_id?: string | null; invite_email?: string | null;
};
type Group = { code: string; name: string; items: { code: string; name: string }[] };
const uuid = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined);
type I18n = { en?: string; ar?: string };
export type ProfileData = {
  id: string; slug: string; phone: string | null; address: string | null; lat: number; lng: number; founder_name: string | null;
  about_fa: string | null; about_i18n: I18n; hours: { always?: boolean; shifts?: Shift[]; note?: string };
  kind_codes: string[]; services: string[]; service_codes?: string[]; insurers: string[]; officers: Officer[];
  mode?: "direct" | "review" | "locked";
  change?: { payload: Partial<ProfileData>; status: "pending" | "rejected"; note: string | null; submitted_at: string } | null;
};
type Opt = { code: string; name: string };
type MapLabels = Parameters<typeof MapPicker>[0]["labels"];

export function ProfileEditor({ initial, kinds, insurers, groups, map, mapLabels, texts: P, r5, r6, locale, aiOn }: {
  initial: ProfileData; kinds: Opt[]; insurers: Opt[]; groups: Group[];
  map: { tileUrl: string; attribution: string; searchUrl: string }; mapLabels: MapLabels;
  texts: ProfileTexts; r5: Round5Texts; r6: Round6Texts; locale: string; aiOn: boolean;
}) {
  // a change waiting for (or rejected by) Dorva is what the editor continues from
  const start0 = initial.change?.payload ? { ...initial, ...initial.change.payload, id: initial.id, slug: initial.slug } : initial;
  const [d, setD] = useState<ProfileData>({
    ...start0, service_codes: start0.service_codes ?? [], hours: start0.hours ?? {},
    officers: (start0.officers ?? []).map((o) => ({ ...o, profile: o.profile ?? {} })),
  });
  const [change, setChange] = useState(initial.change ?? null);
  const locked = initial.mode === "locked";
  const R6 = r6.profile;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof ProfileData>(k: K, v: ProfileData[K]) => { setD((x) => ({ ...x, [k]: v })); setMsg(null); };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = () => start(async () => {
    const r = await savePharmacyProfile(d.id, {
      phone: d.phone, address: d.address, lat: d.lat, lng: d.lng, founder_name: d.founder_name, about_fa: d.about_fa,
      about_i18n: d.about_i18n, hours: d.hours, kind_codes: d.kind_codes, services: d.services, service_codes: d.service_codes,
      insurers: d.insurers, officers: d.officers,
    });
    if (r === "pending") setChange({ payload: {}, status: "pending", note: null, submitted_at: new Date().toISOString() });
    if (r === "ok") setChange(null);
    setMsg(r === "ok" ? { ok: true, text: P.saved } : r === "pending" ? { ok: true, text: R6.pending }
      : r === "locked" ? { ok: false, text: R6.locked } : { ok: false, text: P.result[r] ?? P.result.unknown });
  });
  const discard = () => start(async () => {
    await cancelProfileChange(d.id);
    window.location.reload();
  });

  const card = (title: string, body: React.ReactNode) => (
    <section className="card space-y-3"><h2 className="font-bold">{title}</h2>{body}</section>
  );

  return (
    <div className="space-y-4">
      {locked && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{R6.locked}</p>}
      {!locked && initial.mode === "review" && !change && <p className="text-xs text-muted">{R6.reviewHint}</p>}
      {change?.status === "pending" && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p>{R6.pendingBanner.replace("{t}", new Date(change.submitted_at).toLocaleString(locale === "fa" ? "fa-IR" : locale))}</p>
          <button type="button" onClick={discard} disabled={pending} className="text-xs underline">{R6.cancel}</button>
        </div>
      )}
      {change?.status === "rejected" && (
        <div className="space-y-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p>{R6.rejectedBanner.replace("{n}", change.note ?? "—")}</p>
          <button type="button" onClick={discard} disabled={pending} className="text-xs underline">{R6.cancel}</button>
        </div>
      )}
      {card(P.sec.basic, (
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">{P.phone}</span>
            <input dir="ltr" value={d.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="input" maxLength={30} /></label>
          <label className="sm:col-span-2"><span className="label">{P.address}</span>
            <input value={d.address ?? ""} onChange={(e) => set("address", e.target.value)} className="input" maxLength={300} /></label>
        </div>
      ))}

      {card(P.sec.location, (
        <>
          <p className="text-xs text-muted">{P.mapHint}</p>
          <MapPicker {...map} center={{ lat: d.lat, lng: d.lng }} initial={{ lat: d.lat, lng: d.lng }} markers={[]} locale={locale}
            labels={mapLabels} withAddress={false} onChange={(p) => setD((x) => ({ ...x, lat: p.lat, lng: p.lng }))} />
          <p className="text-xs text-muted" dir="ltr">{d.lat}, {d.lng}</p>
        </>
      ))}

      {card(P.sec.people, (
        <div className="space-y-4">
          <label className="block max-w-md"><span className="label">{P.founder}</span>
            <input value={d.founder_name ?? ""} onChange={(e) => set("founder_name", e.target.value)} className="input" maxLength={80} /></label>
          <div className="space-y-3">
            <h3 className="text-sm font-bold">{P.officers}</h3>
            {d.officers.map((o, i) => (
              <OfficerCard key={o.id ?? i} o={o} P={P} r5={r5} r6={r6} folder={d.id} aiOn={aiOn}
                onChange={(n) => set("officers", d.officers.map((x, j) => (j === i ? n : x)))}
                onRemove={() => set("officers", d.officers.filter((_, j) => j !== i))} />
            ))}
            <button type="button" className="btn-ghost text-sm"
              onClick={() => set("officers", [...d.officers, { id: uuid(), full_name: "", shifts: [], profile: {} }])}>+ {P.addOfficer}</button>
          </div>
        </div>
      ))}

      {card(P.sec.kinds, (
        <div className="space-y-3">
          <Checks title={P.kinds} opts={kinds} on={d.kind_codes} flip={(c) => set("kind_codes", toggle(d.kind_codes, c))} />
          <Checks title={P.insurers} opts={insurers} on={d.insurers} flip={(c) => set("insurers", toggle(d.insurers, c))} />
          <fieldset className="space-y-2">
            <legend className="label">{r5.services.title}</legend>
            <p className="text-xs text-muted">{r5.services.help} — {r5.services.selected.replace("{n}", String((d.service_codes ?? []).length))}</p>
            {groups.map((g) => (
              <details key={g.code} open={g.items.some((x) => (d.service_codes ?? []).includes(x.code))} className="rounded-xl border border-line p-2">
                <summary className="cursor-pointer text-sm font-bold">
                  {g.name} <span className="text-xs font-normal text-muted">({g.items.filter((x) => (d.service_codes ?? []).includes(x.code)).length}/{g.items.length})</span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {g.items.map((o) => {
                    const on = (d.service_codes ?? []).includes(o.code);
                    return (
                      <button key={o.code} type="button" aria-pressed={on} onClick={() => set("service_codes", toggle(d.service_codes ?? [], o.code))}
                        className={`rounded-full border px-3 py-1 text-xs ${on ? "border-brand-600 bg-brand-600 text-white" : "border-line hover:bg-brand-50"}`}>{on ? "✓ " : ""}{o.name}</button>
                    );
                  })}
                </div>
              </details>
            ))}
          </fieldset>
          <Tags label={P.services} ph={P.servicesPh} value={d.services} onChange={(v) => set("services", v)} />
        </div>
      ))}

      {card(P.sec.hours, (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!d.hours.always} onChange={(e) => set("hours", { ...d.hours, always: e.target.checked })} className="h-4 w-4 accent-brand-600" />
            {P.always}
          </label>
          {!d.hours.always && <Shifts value={d.hours.shifts ?? []} P={P} onChange={(v) => set("hours", { ...d.hours, shifts: v })} />}
          <label className="block"><span className="label">{P.hoursNote}</span>
            <input value={d.hours.note ?? ""} maxLength={120} onChange={(e) => set("hours", { ...d.hours, note: e.target.value })} className="input" /></label>
        </div>
      ))}

      {card(P.sec.about, (
        <div className="space-y-3">
          <label className="block"><span className="label">{P.aboutFa}</span>
            <textarea rows={6} maxLength={3000} value={d.about_fa ?? ""} onChange={(e) => set("about_fa", e.target.value)} className="input leading-7" /></label>
          <details>
            <summary className="cursor-pointer text-xs text-muted">{P.otherLangs}</summary>
            <div className="mt-2 grid gap-2">
              <textarea dir="ltr" rows={4} placeholder={P.aboutEn} value={d.about_i18n.en ?? ""} onChange={(e) => set("about_i18n", { ...d.about_i18n, en: e.target.value })} className="input" />
              <textarea rows={4} placeholder={P.aboutAr} value={d.about_i18n.ar ?? ""} onChange={(e) => set("about_i18n", { ...d.about_i18n, ar: e.target.value })} className="input" />
            </div>
          </details>
          <AiWriter pharmacy={d.id} P={P} aiOn={aiOn}
            onText={(t, mode, lang) => {
              if (lang === "fa") set("about_fa", mode === "use" || !d.about_fa ? t : `${d.about_fa}\n\n${t}`);
              else { const cur = d.about_i18n[lang] ?? ""; set("about_i18n", { ...d.about_i18n, [lang]: mode === "use" || !cur ? t : `${cur}\n\n${t}` }); }
            }} />
        </div>
      ))}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg">
        <button type="button" onClick={save} disabled={pending || locked} className="btn">{P.save}</button>
        <a href={`/${locale}/${d.slug}?tab=about`} target="_blank" rel="noreferrer" className="btn-ghost text-sm">{P.viewPage} ↗</a>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

function Checks({ title, opts, on, flip }: { title: string; opts: Opt[]; on: string[]; flip: (c: string) => void }) {
  return (
    <fieldset>
      <legend className="label">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <button key={o.code} type="button" aria-pressed={on.includes(o.code)} onClick={() => flip(o.code)}
            className={`rounded-full border px-3 py-1 text-xs ${on.includes(o.code) ? "border-brand-600 bg-brand-600 text-white" : "border-line hover:bg-brand-50"}`}>{o.name}</button>
        ))}
      </div>
    </fieldset>
  );
}

function Tags({ label, ph, value, onChange }: { label: string; ph: string; value: string[]; onChange: (v: string[]) => void }) {
  const [t, setT] = useState("");
  const add = () => { const v = t.trim(); if (v && !value.includes(v) && value.length < 20) onChange([...value, v.slice(0, 60)]); setT(""); };
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2">
        {value.map((v) => (
          <span key={v} className="chip">{v} <button type="button" aria-label="×" onClick={() => onChange(value.filter((x) => x !== v))} className="ms-1 text-red-700">×</button></span>
        ))}
      </div>
      <input value={t} placeholder={ph} onChange={(e) => setT(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className="input mt-2" />
    </div>
  );
}

function Shifts({ value, onChange, P }: { value: Shift[]; onChange: (v: Shift[]) => void; P: ProfileTexts }) {
  const up = (i: number, s: Shift) => onChange(value.map((x, j) => (j === i ? s : x)));
  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
          <div className="flex flex-wrap gap-1">
            {P.days.map((name, day) => (
              <button key={day} type="button" aria-pressed={s.days.includes(day)}
                onClick={() => up(i, { ...s, days: s.days.includes(day) ? s.days.filter((x) => x !== day) : [...s.days, day].sort() })}
                className={`rounded-lg border px-2 py-1 text-xs ${s.days.includes(day) ? "border-brand-600 bg-brand-600 text-white" : "border-line"}`}>{name}</button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs">{P.from}
            <input type="time" dir="ltr" value={s.from} onChange={(e) => up(i, { ...s, from: e.target.value })} className="input w-28 py-1 text-xs" /></label>
          <label className="flex items-center gap-1 text-xs">{P.to}
            <input type="time" dir="ltr" value={s.to} onChange={(e) => up(i, { ...s, to: e.target.value })} className="input w-28 py-1 text-xs" /></label>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="ms-auto text-xs text-red-700">{P.remove}</button>
        </div>
      ))}
      <button type="button" className="btn-ghost text-xs" onClick={() => onChange([...value, { days: [0, 1, 2, 3, 4, 5], from: "08:00", to: "22:00" }])}>+ {P.addShift}</button>
    </div>
  );
}

function OfficerCard({ o, onChange, onRemove, P, r5, r6, folder, aiOn }: {
  o: Officer; onChange: (o: Officer) => void; onRemove: () => void; P: ProfileTexts; r5: Round5Texts; r6: Round6Texts; folder: string; aiOn: boolean;
}) {
  const I = r6.officerInvite;
  const [up, setUp] = useState<"idle" | "busy" | "fail">("idle");
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
    if (!ext || file.size > 2 * 1024 * 1024) { setUp("fail"); return; }
    setUp("busy");
    const path = `${folder}/${newId()}${newId()}.${ext}`;
    const { error } = await createClient().storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setUp("fail"); return; }
    setUp("idle");
    onChange({ ...o, photo: path });
  };
  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-1 text-center">
          {o.photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={mediaUrl(o.photo)} alt="" className="h-20 w-20 rounded-full border border-line object-cover" />
            : <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-50 text-xl text-brand-700">{o.full_name.slice(0, 1) || "?"}</span>}
          <label className="block cursor-pointer text-xs text-brand-700 hover:underline">
            {up === "busy" ? P.uploading : P.upload}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {up === "fail" && <p className="max-w-24 text-[10px] text-red-700">{P.uploadFail}</p>}
        </div>
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          <label><span className="label">{P.officerName}</span>
            <input value={o.full_name} maxLength={80} onChange={(e) => onChange({ ...o, full_name: e.target.value })} className="input" /></label>
          <label><span className="label">{P.council}</span>
            <input dir="ltr" value={o.council_no ?? ""} maxLength={30} onChange={(e) => onChange({ ...o, council_no: e.target.value })} className="input" /></label>
          <label className="sm:col-span-2"><span className="label">{I.email}</span>
            <div className="flex flex-wrap items-center gap-2">
              <input type="email" dir="ltr" value={o.invite_email ?? ""} maxLength={120} placeholder="name@example.com"
                onChange={(e) => onChange({ ...o, invite_email: e.target.value.trim() || null })} className="input max-w-xs" />
              {o.user_id ? <span className="chip bg-emerald-50 text-xs text-emerald-700">✓ {I.linked}</span>
                : o.invite_email ? <span className="chip text-xs">{I.invited}</span> : null}
            </div>
            <span className="mt-1 block text-xs text-muted">{I.emailHelp}</span></label>
          <label className="sm:col-span-2"><span className="label">{P.officerBio}</span>
            <textarea rows={3} maxLength={1500} value={o.bio ?? ""} onChange={(e) => onChange({ ...o, bio: e.target.value })} className="input leading-7" /></label>
        </div>
        <button type="button" onClick={onRemove} className="text-xs text-red-700">{P.remove}</button>
      </div>
      <div><span className="label">{P.officerShifts}</span>
        <Shifts value={o.shifts ?? []} P={P} onChange={(v) => onChange({ ...o, shifts: v })} /></div>
      <OfficerProfileBox o={o} onChange={onChange} P={P} T={r5.officer} folder={folder} aiOn={aiOn} />
    </div>
  );
}

function OfficerProfileBox({ o, onChange, P, T, folder, aiOn }: {
  o: Officer; onChange: (o: Officer) => void; P: ProfileTexts; T: Round5Texts["officer"]; folder: string; aiOn: boolean;
}) {
  const pr: OfficerProfile = o.profile ?? {};
  const setP = (patch: Partial<OfficerProfile>) => onChange({ ...o, profile: { ...pr, ...patch } });
  const [up, setUp] = useState<{ state: "idle" | "busy" | "fail" | "ok" | "notext"; n?: number }>({ state: "idle" });
  const [tone, setTone] = useState("semi");
  const [length, setLength] = useState("medium");
  const [lang, setLang] = useState<"fa" | "en" | "ar">("fa");
  const [out, setOut] = useState<string | null>(null);
  const [ai, setAi] = useState<"idle" | "busy" | "fail">("idle");
  const field = (k: keyof OfficerProfile, label: string, ph = "", opts: { area?: boolean; dir?: "ltr"; max?: number } = {}) => (
    <label className={opts.area ? "sm:col-span-2" : ""}><span className="label">{label}</span>
      {opts.area
        ? <textarea rows={3} maxLength={opts.max ?? 1500} placeholder={ph} value={(pr[k] as string) ?? ""} onChange={(e) => setP({ [k]: e.target.value } as Partial<OfficerProfile>)} className="input" />
        : <input dir={opts.dir} maxLength={opts.max ?? 200} placeholder={ph} value={(pr[k] as string) ?? ""} onChange={(e) => setP({ [k]: e.target.value } as Partial<OfficerProfile>)} className="input" />}
    </label>
  );
  const radio = (opts: Record<string, string>, v: string, setV: (x: string) => void) => (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {Object.entries(opts).map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={v === k} onClick={() => setV(k)}
          className={`rounded-lg border px-2.5 py-1 text-xs ${v === k ? "border-brand-600 bg-brand-600 text-white" : "border-line"}`}>{label}</button>
      ))}
    </div>
  );
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setUp({ state: "fail" }); return; }
    setUp({ state: "busy" });
    const fd = new FormData();
    fd.set("pharmacy", folder);
    fd.set("file", file);
    const r = await uploadResume(fd);
    if ("error" in r) { setUp({ state: "fail" }); return; }
    onChange({ ...o, resume: r.path, profile: { ...pr, resume_text: r.text ? r.text.slice(0, 8000) : pr.resume_text } });
    setUp(r.text ? { state: "ok", n: r.text.length } : { state: "notext" });
  };
  const removeResume = async () => {
    if (o.resume) await createClient().storage.from("officer-docs").remove([o.resume]).catch(() => null);
    onChange({ ...o, resume: null });
    setUp({ state: "idle" });
  };
  const go = async () => {
    if (o.full_name.trim().length < 2) { setAi("fail"); setOut(T.needName); return; }
    setAi("busy"); setOut(null);
    const t = await writeOfficerBio(folder, { full_name: o.full_name, council_no: o.council_no, profile: pr as Record<string, unknown> },
      { tone, length, lang }, { degrees: T.degrees, areas: T.areaOpts, expertise: T.expertiseOpts });
    if (!t) { setAi("fail"); return; }
    setAi("idle"); setOut(t);
  };
  const ex = pr.expertise ?? [];
  return (
    <details className="rounded-xl border border-dashed border-brand-500 p-3">
      <summary className="cursor-pointer text-sm font-bold text-brand-700">✦ {T.profileTitle}</summary>
      <div className="mt-3 space-y-4 text-sm">
        <p className="text-xs text-muted">{T.profileIntro}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label><span className="label">{T.degree}</span>
            <select value={pr.degree ?? ""} onChange={(e) => setP({ degree: e.target.value })} className="input">
              <option value="">—</option>
              {Object.entries(T.degrees).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          {field("specialty", T.specialty, T.specialtyPh)}
          {field("university", T.university)}
          {field("grad_year", T.gradYear, "", { dir: "ltr", max: 4 })}
          {field("other_degrees", T.otherDegrees, T.otherDegreesPh, { area: true, max: 600 })}
          {field("years_total", T.yearsTotal, "", { dir: "ltr", max: 2 })}
          {field("languages", T.languages, T.languagesPh)}
        </div>
        <fieldset>
          <legend className="label">{T.areas}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(T.areaOpts).map(([k, label]) => (
              <label key={k} className="text-xs"><span className="mb-1 block text-muted">{label}</span>
                <input type="number" min={0} max={60} dir="ltr" value={pr.areas?.[k] ?? ""}
                  onChange={(e) => setP({ areas: { ...(pr.areas ?? {}), [k]: e.target.value } })} className="input py-1" /></label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">{T.expertise}</legend>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(T.expertiseOpts).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={ex.includes(k)} onClick={() => setP({ expertise: ex.includes(k) ? ex.filter((x) => x !== k) : [...ex, k] })}
                className={`rounded-full border px-3 py-1 text-xs ${ex.includes(k) ? "border-brand-600 bg-brand-600 text-white" : "border-line hover:bg-brand-50"}`}>{label}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          {field("work_history", T.workHistory, T.workHistoryPh, { area: true })}
          {field("achievements", T.achievements, T.achievementsPh, { area: true, max: 1000 })}
        </div>
        <div className="space-y-2 rounded-xl bg-paper p-3">
          <span className="label">{T.resume}</span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn-ghost cursor-pointer text-xs">
              {up.state === "busy" ? T.resumeBusy : T.resumeUpload}
              <input type="file" className="hidden" disabled={up.state === "busy"}
                accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx"
                onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            {o.resume && (
              <>
                <a href={`/api/pharmacy/officer-resume?path=${encodeURIComponent(o.resume)}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">{T.resumeView} ↗</a>
                <button type="button" onClick={removeResume} className="text-xs text-red-700">{T.resumeRemove}</button>
              </>
            )}
          </div>
          {up.state === "ok" && <p className="text-xs text-brand-700">{T.resumeRead.replace("{n}", String(up.n ?? 0))}</p>}
          {up.state === "notext" && <p className="text-xs text-amber-800">{T.resumeNoText}</p>}
          {up.state === "fail" && <p className="text-xs text-red-700">{T.resumeFail}</p>}
          <details open={!!pr.resume_text}>
            <summary className="cursor-pointer text-xs text-muted">{T.resumeText}</summary>
            <textarea rows={6} maxLength={8000} value={pr.resume_text ?? ""} onChange={(e) => setP({ resume_text: e.target.value })} className="input mt-2 text-xs leading-6" />
          </details>
        </div>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={!!pr.consent} onChange={(e) => setP({ consent: e.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-600" />
          {T.consent}
        </label>
        <div className="space-y-2 border-t border-line pt-3">
          <p className="font-bold">{T.aiTitle}</p>
          {!aiOn ? <p className="text-xs text-muted">{P.ai.off}</p> : (
            <>
              <p className="text-xs text-muted">{T.aiIntro}</p>
              <div><span className="label">{P.ai.tone}</span>{radio(P.ai.tones, tone, setTone)}</div>
              <div><span className="label">{P.ai.length}</span>{radio(P.ai.lengths, length, setLength)}</div>
              <div className="flex gap-1.5">{(["fa", "en", "ar"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
                  className={`rounded-lg border px-2 py-1 text-xs ${lang === l ? "border-brand-600 bg-brand-50" : "border-line"}`}>{l === "fa" ? "فارسی" : l === "en" ? "English" : "العربية"}</button>
              ))}</div>
              <button type="button" onClick={go} disabled={ai === "busy"} className="btn text-sm">{ai === "busy" ? T.generating : T.generate}</button>
              {ai === "fail" && <p className="text-xs text-red-700">{out ?? T.fail}</p>}
              {out && ai !== "fail" && (
                <div className="space-y-2 rounded-xl bg-paper p-3">
                  <p className="whitespace-pre-line leading-7" dir={lang === "en" ? "ltr" : "rtl"}>{out}</p>
                  <button type="button" onClick={() => { onChange({ ...o, bio: out.slice(0, 1500) }); }} className="btn-ghost text-xs">{T.use}</button>
                  <p className="text-xs text-muted">{T.saveHint}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </details>
  );
}

function AiWriter({ pharmacy, P, aiOn, onText }: { pharmacy: string; P: ProfileTexts; aiOn: boolean; onText: (t: string, mode: "use" | "append", lang: "fa" | "en" | "ar") => void }) {
  const A = P.ai;
  const [goals, setGoals] = useState<string[]>(["care"]);
  const [points, setPoints] = useState<string[]>([]);
  const [tone, setTone] = useState("semi");
  const [length, setLength] = useState("medium");
  const [extra, setExtra] = useState("");
  const [lang, setLang] = useState<"fa" | "en" | "ar">("fa");
  const [out, setOut] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "fail">("idle");
  const radio = (name: string, opts: Record<string, string>, v: string, setV: (x: string) => void) => (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={name}>
      {Object.entries(opts).map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={v === k} onClick={() => setV(k)}
          className={`rounded-lg border px-2.5 py-1 text-xs ${v === k ? "border-brand-600 bg-brand-600 text-white" : "border-line"}`}>{label}</button>
      ))}
    </div>
  );
  const go = async () => {
    setState("busy"); setOut(null);
    const t = await writeAbout(pharmacy, { goals, points, tone, length, extra, lang }, { goals: A.goals, points: A.pointOpts });
    if (!t) { setState("fail"); return; }
    setState("idle"); setOut(t);
  };
  return (
    <details className="rounded-xl border border-dashed border-brand-500 p-3">
      <summary className="cursor-pointer text-sm font-bold text-brand-700">✦ {A.title}</summary>
      {!aiOn ? <p className="mt-2 text-xs text-muted">{A.off}</p> : (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-muted">{A.intro}</p>
          <div><span className="label">{A.goal}</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(A.goals).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={goals.includes(k)}
                  onClick={() => setGoals(goals.includes(k) ? goals.filter((x) => x !== k) : [...goals, k])}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${goals.includes(k) ? "border-brand-600 bg-brand-600 text-white" : "border-line"}`}>{goals.includes(k) ? "✓ " : ""}{label}</button>
              ))}
            </div>
          </div>
          <div><span className="label">{A.points}</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(A.pointOpts).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs">
                  <input type="checkbox" checked={points.includes(k)} onChange={(e) => setPoints(e.target.checked ? [...points, k] : points.filter((x) => x !== k))} className="accent-brand-600" />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div><span className="label">{A.tone}</span>{radio(A.tone, A.tones, tone, setTone)}</div>
          <div><span className="label">{A.length}</span>{radio(A.length, A.lengths, length, setLength)}</div>
          <div className="flex gap-1.5">{(["fa", "en", "ar"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
              className={`rounded-lg border px-2 py-1 text-xs ${lang === l ? "border-brand-600 bg-brand-50" : "border-line"}`}>{l === "fa" ? "فارسی" : l === "en" ? "English" : "العربية"}</button>
          ))}</div>
          <label className="block"><span className="label">{A.extra}</span>
            <input value={extra} maxLength={300} placeholder={A.extraPh} onChange={(e) => setExtra(e.target.value)} className="input" /></label>
          <button type="button" onClick={go} disabled={state === "busy"} className="btn text-sm">{state === "busy" ? A.generating : A.generate}</button>
          {state === "fail" && <p className="text-xs text-red-700">{A.fail}</p>}
          {out && (
            <div className="space-y-2 rounded-xl bg-paper p-3">
              <p className="whitespace-pre-line leading-7" dir={lang === "en" ? "ltr" : "rtl"}>{out}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => onText(out, "use", lang)} className="btn-ghost text-xs">{A.use}</button>
                <button type="button" onClick={() => onText(out, "append", lang)} className="btn-ghost text-xs">{A.append}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

/** The pharmacist's own editor (/account/pharmacist): name, photo, bio and professional profile. */
export function OfficerSelfEditor({ initial, me, folder, P, r5, r6, aiOn }: {
  initial: Officer; me: string; folder: string; P: ProfileTexts; r5: Round5Texts; r6: Round6Texts; aiOn: boolean;
}) {
  const M = r6.me;
  const [o, setO] = useState<Officer>({ ...initial, profile: initial.profile ?? {} });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [up, setUp] = useState<"idle" | "busy" | "fail">("idle");
  const [busy, start] = useTransition();
  const change = (n: Officer) => { setO(n); setMsg(null); };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
    if (!ext || file.size > 2 * 1024 * 1024) { setUp("fail"); return; }
    setUp("busy");
    const path = `${me}/${newId()}${newId()}.${ext}`;
    const { error } = await createClient().storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setUp("fail"); return; }
    setUp("idle");
    change({ ...o, photo: path });
  };
  const save = () => start(async () => {
    const r = await saveMyOfficerProfile({ full_name: o.full_name, council_no: o.council_no, photo: o.photo, bio: o.bio, profile: o.profile, resume: o.resume });
    setMsg({ ok: r === "ok" || r === "pending", text: M.results[r] ?? M.results.unknown });
  });
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="space-y-1 text-center">
            {o.photo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={mediaUrl(o.photo)} alt="" className="h-24 w-24 rounded-full border border-line object-cover" />
              : <span className="grid h-24 w-24 place-items-center rounded-full bg-brand-50 text-2xl text-brand-700">{o.full_name.slice(0, 1) || "?"}</span>}
            <label className="block cursor-pointer text-xs text-brand-700 hover:underline">
              {up === "busy" ? P.uploading : P.upload}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            {up === "fail" && <p className="max-w-24 text-[10px] text-red-700">{P.uploadFail}</p>}
          </div>
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <label><span className="label">{P.officerName}</span>
              <input value={o.full_name} maxLength={80} onChange={(e) => change({ ...o, full_name: e.target.value })} className="input" /></label>
            <label><span className="label">{P.council}</span>
              <input dir="ltr" value={o.council_no ?? ""} maxLength={30} onChange={(e) => change({ ...o, council_no: e.target.value })} className="input" /></label>
            <label className="sm:col-span-2"><span className="label">{P.officerBio}</span>
              <textarea rows={4} maxLength={1500} value={o.bio ?? ""} onChange={(e) => change({ ...o, bio: e.target.value })} className="input leading-7" /></label>
          </div>
        </div>
        <OfficerProfileBox o={o} onChange={change} P={P} T={r5.officer} folder={folder} aiOn={aiOn} />
      </section>
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg">
        <button type="button" onClick={save} disabled={busy} className="btn">{M.save}</button>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
