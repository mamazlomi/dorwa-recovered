"use client";

import { useState, useTransition } from "react";
import { mediaUrl, MEDIA_BUCKET, newId } from "@/lib/pageBlocks";
import { saveMyStaffProfile } from "@/lib/staffActions";
import { createClient } from "@/lib/supabase/client";

type Profile = {
  full_name?: string | null; photo?: string | null; phone?: string | null; education?: string | null; experience?: string | null;
  expertise?: string[]; council_no?: string | null; bio?: string | null; is_public?: boolean;
};
type L = {
  myProfile: string; myProfileIntro: string; fullName: string; photo: string; phone: string; education: string; educationPh: string;
  experience: string; experiencePh: string; expertise: string; council: string; bio: string; isPublic: string; save: string;
  saved: string; saveFail: string; photoFail: string; upload: string; uploading: string; uploadFail: string;
};

// The signed-in staff member's own profile / CV.
export function StaffProfileForm({ userId, initial, labels, expertiseOpts }: {
  userId: string; initial: Profile; labels: L; expertiseOpts: Record<string, string>;
}) {
  const [p, setP] = useState<Profile>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [up, setUp] = useState<"idle" | "busy" | "fail">("idle");
  const [pending, start] = useTransition();
  const set = (k: keyof Profile, v: unknown) => { setP((x) => ({ ...x, [k]: v })); setMsg(null); };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
    if (!ext || file.size > 2 * 1024 * 1024) { setUp("fail"); return; }
    setUp("busy");
    const path = `${userId}/${newId()}${newId()}.${ext}`;
    const { error } = await createClient().storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setUp("fail"); return; }
    setUp("idle");
    set("photo", path);
  };
  const save = () => start(async () => {
    const r = await saveMyStaffProfile(p as Record<string, unknown>);
    setMsg(r === "ok" ? labels.saved : r === "photo" ? labels.photoFail : labels.saveFail);
  });
  const field = (k: keyof Profile, label: string, opts: { ltr?: boolean; area?: boolean; ph?: string; max?: number } = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      {opts.area
        ? <textarea rows={3} maxLength={opts.max} value={String(p[k] ?? "")} placeholder={opts.ph} onChange={(e) => set(k, e.target.value)} className="input text-sm" />
        : <input dir={opts.ltr ? "ltr" : undefined} maxLength={opts.max} value={String(p[k] ?? "")} placeholder={opts.ph} onChange={(e) => set(k, e.target.value)} className="input text-sm" />}
    </label>
  );

  return (
    <section className="card space-y-4" id="profile">
      <div>
        <h2 className="font-bold">{labels.myProfile}</h2>
        <p className="text-xs text-muted">{labels.myProfileIntro}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {p.photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={mediaUrl(p.photo)} alt="" className="h-20 w-20 rounded-full border border-line object-cover" />
          : <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-50 text-2xl text-brand-700">?</span>}
        <div className="space-y-1">
          <span className="label">{labels.photo}</span>
          <label className="btn-ghost inline-block cursor-pointer text-xs">
            {up === "busy" ? labels.uploading : labels.upload}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {up === "fail" && <p className="text-xs text-red-700">{labels.uploadFail}</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("full_name", labels.fullName, { max: 80 })}
        {field("phone", labels.phone, { ltr: true, max: 30 })}
        {field("council_no", labels.council, { ltr: true, max: 30 })}
      </div>
      <fieldset>
        <legend className="label">{labels.expertise}</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(expertiseOpts).map(([k, name]) => {
            const on = (p.expertise ?? []).includes(k);
            return (
              <button key={k} type="button" aria-pressed={on}
                onClick={() => set("expertise", on ? (p.expertise ?? []).filter((x) => x !== k) : [...(p.expertise ?? []), k])}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-brand-600 bg-brand-600 text-white" : "border-line"}`}>{name}</button>
            );
          })}
        </div>
      </fieldset>
      {field("education", labels.education, { area: true, ph: labels.educationPh, max: 600 })}
      {field("experience", labels.experience, { area: true, ph: labels.experiencePh, max: 1500 })}
      {field("bio", labels.bio, { area: true, max: 800 })}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!p.is_public} onChange={(e) => set("is_public", e.target.checked)} className="h-4 w-4 accent-brand-600" />
        {labels.isPublic}
      </label>
      {msg && <p role="status" className="rounded-xl bg-brand-50 p-2 text-sm text-brand-700">{msg}</p>}
      <button type="button" onClick={save} disabled={pending} className="btn">{labels.save}</button>
    </section>
  );
}
