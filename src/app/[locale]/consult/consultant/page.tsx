import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale, resolveLocale } from "@/i18n";
import { getQualTexts } from "@/i18n/dictionaries/qualification";
import { getConsultTexts } from "@/i18n/dictionaries/consult";
import { isConfigured } from "@/lib/config";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const SPECS = ["pharmacist", "physician", "skin", "nutrition", "other"];

async function save(fd: FormData) {
  "use server";
  const raw = String(fd.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/consult/consultant`);
  const spec = SPECS.includes(String(fd.get("specialty"))) ? String(fd.get("specialty")) : "other";
  const row = {
    user_id: user.id, display_name: String(fd.get("name") ?? "").trim().slice(0, 80), specialty: spec,
    license_no: String(fd.get("license") ?? "").trim().slice(0, 40) || null, bio: String(fd.get("bio") ?? "").trim().slice(0, 800) || null,
  };
  const { error } = await supabase.from("consult_experts").upsert(row, { onConflict: "user_id" });
  redirect(`/${locale}/consult/consultant?r=${error ? "failed" : "saved"}`);
}

export default async function ConsultantPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const C = getConsultTexts(locale);
  const sp = await searchParams;
  const { supabase, user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/consult/consultant`);
  const { data: me } = await supabase.from("consult_experts").select("display_name, specialty, license_no, bio, status").eq("user_id", user.id).maybeSingle();

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href={`/${locale}/consult`} className="text-sm text-brand-700 underline">{C.back}</Link>
      <h1 className="text-xl font-extrabold">{C.becomeTitle}</h1>
      <p className="text-sm leading-7 text-muted">{C.becomeBody}</p>
      <p className="text-xs leading-6 text-muted">{getQualTexts(locale).applyNote}</p>
      {me && <p className="card text-sm">{C.status[me.status as string] ?? me.status}</p>}
      {sp.r === "saved" && <OkBox message={C.saved} />}
      {sp.r === "failed" && <ErrorBox message={C.failed} />}
      <form action={save} className="card space-y-3">
        <input type="hidden" name="locale" value={locale} />
        <div><label className="label" htmlFor="c-name">{C.displayName}</label>
          <input id="c-name" name="name" required minLength={3} maxLength={80} defaultValue={me?.display_name ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="c-spec">{C.specialty}</label>
          <select id="c-spec" name="specialty" defaultValue={me?.specialty ?? "pharmacist"} className="input">
            {SPECS.map((k) => <option key={k} value={k}>{C.specialties[k]}</option>)}</select></div>
        <div><label className="label" htmlFor="c-lic">{C.license}</label>
          <input id="c-lic" name="license" maxLength={40} dir="ltr" defaultValue={me?.license_no ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="c-bio">{C.bio}</label>
          <textarea id="c-bio" name="bio" maxLength={800} rows={4} defaultValue={me?.bio ?? ""} className="input" /></div>
        <SubmitButton className="btn w-full">{C.save}</SubmitButton>
      </form>
    </div>
  );
}
