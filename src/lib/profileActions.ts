"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiEnabled, write } from "@/lib/ai";
import { isUuid } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";
import { resumeKind, resumeText } from "@/lib/resumeText";

export async function savePharmacyProfile(pharmacy: string, profile: Record<string, unknown>): Promise<string> {
  if (!isUuid(pharmacy)) return "unknown";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacy_profile_save", { p_pharmacy: pharmacy, p: profile });
  if (error) return error.code === "42501" ? "forbidden" : "unknown";
  revalidatePath("/[locale]/[slug]", "page");
  return String(data);
}

type Answers = { goals: string[]; points: string[]; tone: string; length: string; extra: string; lang: "fa" | "en" | "ar" };
const DAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const TONE: Record<string, string> = {
  formal: "formal and official, like an institution's introduction",
  semi: "semi-formal, warm but professional",
  friendly: "friendly and conversational, like a neighbourhood shop talking to its customers",
};
const LEN: Record<string, string> = { short: "2-3 sentences", medium: "one paragraph of about 80 words", long: "two paragraphs, about 160 words" };
const LANG: Record<string, string> = { fa: "Persian (Farsi)", en: "English", ar: "Arabic" };

/**
 * Drafts the pharmacy's "about" text from its own profile and the owner's answers.
 * The person reads and edits it before saving; nothing is stored here.
 */
export async function writeAbout(pharmacy: string, answers: Answers, labels: { goals: Record<string, string>; points: Record<string, string> }): Promise<string | null> {
  if (!aiEnabled() || !isUuid(pharmacy)) return null;
  const supabase = await createClient();
  const { data: prof, error } = await supabase.rpc("pharmacy_profile_get", { p_pharmacy: pharmacy });
  if (error || !prof) return null;
  const p = prof as {
    name_fa: string; city_id: number; address: string | null; founder_name: string | null; kind_codes: string[]; insurers: string[];
    services: string[]; service_codes?: string[]; hours: { always?: boolean; shifts?: { days: number[]; from: string; to: string }[] };
    officers: { full_name: string }[];
  };
  const codes = p.service_codes ?? [];
  const [{ data: city }, { data: kinds }, { data: ins }, { data: srv }] = await Promise.all([
    supabase.from("cities").select("name_fa").eq("id", p.city_id).maybeSingle(),
    supabase.from("pharmacy_kinds").select("code, name_fa").in("code", p.kind_codes.length ? p.kind_codes : ["-"]),
    supabase.from("insurers").select("code, name_fa").in("code", p.insurers.length ? p.insurers : ["-"]),
    supabase.from("pharmacy_service_options").select("name_fa").in("code", codes.length ? codes : ["-"]),
  ]);
  const services = [...((srv as { name_fa: string }[] | null) ?? []).map((x) => x.name_fa), ...p.services];
  const hours = p.hours?.always ? "شبانه‌روزی" :
    (p.hours?.shifts ?? []).map((s) => `${s.days.map((d) => DAYS[d]).join("، ")} ${s.from} تا ${s.to}`).join(" | ");
  const facts = [
    `Name: ${p.name_fa}`,
    `City: ${(city as { name_fa: string } | null)?.name_fa ?? ""}`,
    p.address ? `Address / neighbourhood: ${p.address}` : "",
    p.founder_name ? `Founder: ${p.founder_name}` : "",
    p.officers.length ? `Pharmacists: ${p.officers.map((o) => o.full_name).join(", ")}` : "",
    (kinds as { name_fa: string }[] | null)?.length ? `Type: ${(kinds as { name_fa: string }[]).map((k) => k.name_fa).join(", ")}` : "",
    (ins as { name_fa: string }[] | null)?.length ? `Insurers accepted: ${(ins as { name_fa: string }[]).map((k) => k.name_fa).join(", ")}` : "",
    services.length ? `Services offered: ${services.join(", ")}` : "",
    hours ? `Hours: ${hours}` : "",
    answers.goals.length ? `Focus of the text: ${answers.goals.map((g) => labels.goals[g] ?? g).join(", ")}` : "",
    answers.points.length ? `Points to mention: ${answers.points.map((x) => labels.points[x] ?? x).join(", ")}` : "",
    answers.extra.trim() ? `Owner's note: ${answers.extra.trim().slice(0, 300)}` : "",
  ].filter(Boolean).join("\n");
  const system = `You write the short "About us" text for a licensed community pharmacy's page on an online pharmacy marketplace. ` +
    `Write in ${LANG[answers.lang] ?? "Persian"}, tone ${TONE[answers.tone] ?? TONE.semi}, length ${LEN[answers.length] ?? LEN.medium}. ` +
    `Use only the facts given; never invent awards, years, prices, discounts or medical claims, and do not promise cures. ` +
    `No headings, no lists, no emojis, no quotation marks. Vary sentence length so it reads naturally.`;
  const out = await write(system, facts, answers.length === "long" ? 700 : 400);
  return out ? out.replace(/^["«“]|["»”]$/g, "").trim().slice(0, 3000) : null;
}

// ---------------------------------------------------------------- officer resume and bio

const MAX_RESUME = 5 * 1024 * 1024;
const RESUME_BUCKET = "officer-docs";

/**
 * Stores a technical officer's resume in the private bucket (the storage policy
 * allows only the pharmacy's profile editors) and returns its path and text.
 */
export async function uploadResume(formData: FormData): Promise<{ path: string; text: string } | { error: string }> {
  const pharmacy = String(formData.get("pharmacy") ?? "");
  const file = formData.get("file");
  if (!isUuid(pharmacy) || !(file instanceof File)) return { error: "fail" };
  if (file.size === 0 || file.size > MAX_RESUME) return { error: "fail" };
  const buf = new Uint8Array(await file.arrayBuffer());
  const kind = resumeKind(buf);
  if (!kind) return { error: "fail" };
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${pharmacy}/resume-${rand}.${kind}`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(path, buf, {
    contentType: kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });
  if (error) {
    console.warn(`[resume] upload refused: ${error.message}`);
    return { error: "fail" };
  }
  return { path, text: await resumeText(buf, kind) };
}

type OfficerIn = {
  full_name: string; council_no?: string | null;
  profile?: Record<string, unknown>;
};
type BioOpts = { tone: string; length: string; lang: "fa" | "en" | "ar" };
const BIO_LEN: Record<string, string> = { short: "2-3 sentences", medium: "one paragraph of about 90 words", long: "two short paragraphs, about 170 words" };

/** Patient-facing introduction of a pharmacist from the questionnaire and resume; reviewed before saving. */
export async function writeOfficerBio(pharmacy: string, o: OfficerIn, opts: BioOpts,
  labels: { degrees: Record<string, string>; areas: Record<string, string>; expertise: Record<string, string> }): Promise<string | null> {
  if (!aiEnabled() || !isUuid(pharmacy) || (o.full_name ?? "").trim().length < 2) return null;
  const supabase = await createClient();
  // the pharmacy's profile editors, or the pharmacist themself (linked to this pharmacy)
  const { data: prof, error } = await supabase.rpc("pharmacy_profile_get", { p_pharmacy: pharmacy });
  let ph = prof as { name_fa: string } | null;
  if (error || !prof) {
    const { data: me } = await supabase.rpc("my_officer_profile");
    const mine = ((me as { pharmacies?: { id: string; name_fa: string }[] } | null)?.pharmacies ?? []).find((x) => x.id === pharmacy);
    if (!mine) return null;
    ph = mine;
  }
  if (!ph) return null;
  const p = (o.profile ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim().slice(0, 600) : "");
  const areas = (p.areas && typeof p.areas === "object" ? Object.entries(p.areas as Record<string, unknown>) : [])
    .filter(([, v]) => Number(v) > 0).map(([k, v]) => `${labels.areas[k] ?? k}: ${Number(v)} years`);
  const resume = typeof p.resume_text === "string" ? (p.resume_text as string).trim().slice(0, 6000) : "";
  const expertise = Array.isArray(p.expertise) ? (p.expertise as string[]).map((x) => labels.expertise[x] ?? x) : [];
  const facts = [
    `Name: ${o.full_name.trim()}`,
    `Pharmacy: ${ph.name_fa}`,
    str("degree") ? `Highest degree: ${labels.degrees[str("degree")] ?? str("degree")}` : "",
    str("specialty") ? `Field: ${str("specialty")}` : "",
    str("university") ? `University: ${str("university")}` : "",
    str("grad_year") ? `Graduated: ${str("grad_year")}` : "",
    str("other_degrees") ? `Other degrees and courses: ${str("other_degrees")}` : "",
    str("years_total") ? `Total experience: ${str("years_total")} years` : "",
    areas.length ? `Experience by area: ${areas.join("; ")}` : "",
    expertise.length ? `Areas of expertise: ${expertise.join(", ")}` : "",
    str("work_history") ? `Work history: ${str("work_history")}` : "",
    str("achievements") ? `Research, awards, memberships: ${str("achievements")}` : "",
    str("languages") ? `Languages: ${str("languages")}` : "",
    resume ? `Resume (raw text, may be messy):\n${resume}` : "",
  ].filter(Boolean).join("\n");
  const system = `You write a short introduction of a pharmacist for patients and visitors of a community pharmacy's page on an online pharmacy marketplace. ` +
    `Write in ${LANG[opts.lang] ?? "Persian"}, in the third person, tone ${TONE[opts.tone] ?? TONE.semi}, length ${BIO_LEN[opts.length] ?? BIO_LEN.medium}. ` +
    `Explain what this person's education and experience mean for a patient (for example: hospital experience means familiarity with complex and special prescriptions; ` +
    `industry or quality-control experience means care about genuine, well-stored medicines; clinical training means careful checks for interactions). ` +
    `Use only the facts given; never invent degrees, years, employers, awards or medical claims, and leave out anything not stated. ` +
    `Do not include phone numbers, addresses, emails or the council number. No headings, lists, emojis or quotation marks. Vary sentence length so it reads naturally.`;
  const out = await write(system, facts, opts.length === "long" ? 700 : 450);
  return out ? out.replace(/^["«“]|["»”]$/g, "").trim().slice(0, 1500) : null;
}

export async function cancelProfileChange(pharmacy: string): Promise<string> {
  if (!isUuid(pharmacy)) return "unknown";
  const { error } = await (await createClient()).rpc("profile_change_cancel", { p_pharmacy: pharmacy });
  return error ? "unknown" : "ok";
}

/** The pharmacist edits their own profile; Dorva reviews it according to the policy. */
export async function saveMyOfficerProfile(p: Record<string, unknown>): Promise<string> {
  const { data, error } = await (await createClient()).rpc("officer_self_save", { p });
  if (error) return "unknown";
  revalidatePath("/[locale]/[slug]", "page");
  return String(data);
}

export async function answerOfficerInvite(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("locale") ?? "fa");
  const locale = ["fa", "en", "ar"].includes(raw) ? raw : "fa";
  if (isUuid(id)) {
    await (await createClient()).rpc("officer_invite_answer", { p_officer: id, p_accept: formData.get("accept") === "1" });
  }
  revalidatePath(`/${locale}/account`);
  redirect(formData.get("accept") === "1" ? `/${locale}/account/pharmacist` : `/${locale}/account`);
}
