import { MobileForm } from "@/components/MobileForm";
import { getRound6Texts } from "@/i18n/dictionaries/round6";
import { answerOfficerInvite } from "@/lib/profileActions";
import Link from "next/link";
import { StaffProfileForm } from "@/components/StaffProfileForm";
import { getTeamTexts } from "@/i18n/dictionaries/team";
import { redirect } from "next/navigation";
import { ADDRESS_FIELDS, AddressList, type SavedAddress } from "@/components/AddressList";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { isLocale, localized, resolveLocale } from "@/i18n";
import { getAddressTexts } from "@/i18n/dictionaries/address";
import { getOrderTexts } from "@/i18n/dictionaries/orders";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { SubmitButton } from "@/components/SubmitButton";
import { answerInvite } from "@/lib/staffActions";
import { readAddress } from "@/lib/address";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";
import { getLookTexts } from "@/i18n/dictionaries/look";
import { myRoles } from "@/lib/roles";

export const dynamic = "force-dynamic";

async function changePassword(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) redirect(`/${locale}/account?error=short`);
  if (password !== String(formData.get("confirm") ?? "")) redirect(`/${locale}/account?error=match`);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  redirect(`/${locale}/account?${error ? "error=save" : "saved=1"}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { t } = await resolveLocale(params);
  return { title: t.account.title };
}

export default async function AccountPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string; r?: string; mobile?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/account`);
  const sp = await searchParams;
  const a = getAddressTexts(locale);
  const supabase = await createClient();
  const [{ data: savedData }, current, { data: invData }, roles, { data: memData }, { data: profData }, { data: offInv }, { data: offMe }] = await Promise.all([
    supabase.from("customer_addresses").select(ADDRESS_FIELDS).order("created_at", { ascending: false }),
    readAddress(),
    supabase.rpc("my_staff_invites"),
    myRoles(user.id),
    supabase.from("memberships").select("id").eq("user_id", user.id).limit(1),
    supabase.rpc("my_staff_profile"),
    supabase.rpc("my_officer_invites"),
    supabase.rpc("my_officer_profile"),
  ]);
  const R6 = getRound6Texts(locale).me;
  const officerInvites = (offInv as { id: string; full_name: string; pharmacy: string; pharmacy_i18n: Record<string, string> }[] | null) ?? [];
  const isStaff = ((memData as unknown[] | null) ?? []).length > 0;
  const T = getTeamTexts(locale);
  const L = getLookTexts(locale);
  const here = `/${locale}/account`;
  const st = getStaffTexts(locale);
  const invites = (invData as { id: string; pharmacy_id: string | null; pharmacy_name: string | null; pharmacy_i18n: Record<string, string> | null; role_name: string }[]) ?? [];
  const inviteMsg = sp.r ? st.inviteResult[sp.r] ?? st.results[sp.r] : null;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">{t.account.title}</h1>
      <p className="text-sm text-muted" dir="ltr">{user.email}</p>
      {sp.saved && <OkBox message={t.account.saved} />}
      {sp.error && <ErrorBox message={t.account.errors[sp.error] ?? t.account.errors.save} />}
      {inviteMsg && (sp.r === "accepted" || sp.r === "declined" ? <OkBox message={inviteMsg} /> : <ErrorBox message={inviteMsg} />)}
      {invites.length > 0 && (
        <section className="card space-y-2 border-brand-500">
          <h2 className="font-bold">{st.invitesTitle}</h2>
          <ul className="divide-y divide-line text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{i.pharmacy_name ? localized(i.pharmacy_name, i.pharmacy_i18n ?? {}, locale) : st.dorva} · {i.role_name}</span>
                <div className="flex gap-2">
                  <form action={answerInvite}>
                    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="back" value={here} />
                    <input type="hidden" name="invite_id" value={i.id} /><input type="hidden" name="accept" value="1" />
                    <SubmitButton className="btn py-1 text-xs">{st.accept}</SubmitButton>
                  </form>
                  <form action={answerInvite}>
                    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="back" value={here} />
                    <input type="hidden" name="invite_id" value={i.id} /><input type="hidden" name="accept" value="0" />
                    <SubmitButton className="btn-ghost py-1 text-xs">{st.decline}</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <MobileForm locale={locale} result={sp.mobile} />
      {officerInvites.length > 0 && (
        <section className="card space-y-2 border-brand-500">
          <h2 className="font-bold">{R6.invitesTitle}</h2>
          <ul className="divide-y divide-line text-sm">
            {officerInvites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{R6.invite.replace("{p}", localized(i.pharmacy, i.pharmacy_i18n ?? {}, locale)).replace("{n}", i.full_name)}</span>
                <div className="flex gap-2">
                  <form action={answerOfficerInvite}>
                    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="accept" value="1" />
                    <SubmitButton className="btn py-1 text-xs">{R6.accept}</SubmitButton>
                  </form>
                  <form action={answerOfficerInvite}>
                    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="accept" value="0" />
                    <SubmitButton className="btn-ghost py-1 text-xs">{R6.decline}</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {offMe != null && (
        <section className="card flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">{R6.intro}</span>
          <Link href={`/${locale}/account/pharmacist`} className="btn">{R6.link}</Link>
        </section>
      )}
      {(roles.pharmacy || roles.platform) && (
        <section className="card space-y-2">
          <h2 className="font-bold">{L.panelsTitle}</h2>
          <p className="text-xs text-muted">{L.panelsHint}</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/${locale}/pharmacy/dashboard`} className="btn-ghost">{L.pharmacyPanel}</Link>
            <Link href={`/${locale}/pharmacy/orders`} className="btn-ghost">{L.pharmacyOrders}</Link>
            {roles.platform && <Link href={`/${locale}/admin/dashboard`} className="btn">{L.adminPanel}</Link>}
          </div>
        </section>
      )}
      {isStaff && (
        <StaffProfileForm userId={user.id} initial={(profData as Record<string, unknown>) ?? {}} expertiseOpts={T.expertiseOpts}
          labels={{ myProfile: T.myProfile, myProfileIntro: T.myProfileIntro, fullName: T.fullName, photo: T.photo, phone: T.phone,
            education: T.education, educationPh: T.educationPh, experience: T.experience, experiencePh: T.experiencePh,
            expertise: T.expertise, council: T.council, bio: T.bio, isPublic: T.isPublic, save: T.save, saved: T.saved,
            saveFail: T.saveFail, photoFail: T.photoFail, upload: T.upload, uploading: T.uploading, uploadFail: T.uploadFail }} />
      )}
      <Link href={`/${locale}/account/orders`} className="card flex items-center justify-between font-bold hover:border-brand-500">
        <span>{getOrderTexts(locale).myOrders}</span><span aria-hidden>‹</span>
      </Link>
      {(roles.pharmacy || roles.platform) && (
        <Link href={`/${locale}/holding`} className="card flex items-center justify-between font-bold hover:border-brand-500">
          <span>{st.holdingsTitle}</span><span aria-hidden>‹</span>
        </Link>
      )}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{a.saved}</h2>
          <Link href={`/${locale}/account/address?back=${encodeURIComponent(here)}#form`} className="btn-ghost py-1.5 text-xs">{a.manage}</Link>
        </div>
        <AddressList locale={locale} saved={(savedData as unknown as SavedAddress[]) ?? []} activeId={current?.id} back={here} here={here} />
      </section>
      <div className="card space-y-3">
        <h2 className="font-bold">{t.account.changePassword}</h2>
        <form action={changePassword} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <input name="password" type="password" dir="ltr" required minLength={10} className="input" placeholder={t.account.newPassword} autoComplete="new-password" />
          <input name="confirm" type="password" dir="ltr" required minLength={10} className="input" placeholder={t.account.confirmPassword} autoComplete="new-password" />
          <button className="btn w-full">{t.account.savePassword}</button>
        </form>
      </div>
    </div>
  );
}
