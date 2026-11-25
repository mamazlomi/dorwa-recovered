import { AccessEditor, type Perm } from "@/components/AccessEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, type Locale } from "@/i18n";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { getTeamTexts } from "@/i18n/dictionaries/team";
import { mediaUrl } from "@/lib/pageBlocks";
import { inviteStaff, revokeInvite, setStaffAccess, updateStaff } from "@/lib/staffActions";

type Profile = { photo?: string | null; phone?: string | null; education?: string | null; experience?: string | null;
  expertise?: string[]; council_no?: string | null; bio?: string | null; is_public?: boolean } | null;
export type StaffMember = {
  membership_id: string; user_id: string; email: string; full_name: string | null; role_id: string; role_code: string;
  role_name: string; status: string; license_no: string | null; created_at: string; is_me: boolean;
  perms: string[]; custom: boolean; profile: Profile;
};
export type RoleTemplate = { id: string; code: string; name_fa: string; permissions: string[]; needs_license: boolean; can_grant: boolean };
export type StaffInvite = { id: string; email: string; role_id: string; created_at: string; expires_at: string };
export type { Perm };

// Members, pending invitations and the invite form for one pharmacy (or Dorva when pharmacyId is null).
export function StaffPanel({ locale, pharmacyId, back, members, invites, roles, perms }: {
  locale: Locale; pharmacyId: string | null; back: string;
  members: StaffMember[]; invites: StaffInvite[]; roles: RoleTemplate[]; perms: Perm[];
}) {
  const s = getStaffTexts(locale);
  const T = getTeamTexts(locale);
  const grantable = roles.filter((r) => r.can_grant && r.code !== "no_access");
  const roleName = new Map(roles.map((r) => [r.id, r.name_fa]));
  const date = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium" });
  const permName = Object.fromEntries(perms.map((p) => [p.code, T.perms[p.code] ?? p.description_fa]));
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />
      {pharmacyId && <input type="hidden" name="pharmacy_id" value={pharmacyId} />}
    </>
  );

  return (
    <div className="space-y-4">
      <form action={inviteStaff} className="card grid gap-3 sm:grid-cols-2">
        {hidden}
        <h2 className="font-bold sm:col-span-2">{s.invite}</h2>
        <label><span className="label">{s.email}</span>
          <input name="email" type="email" required dir="ltr" className="input" /></label>
        <label><span className="label">{s.role}</span>
          <select name="role_id" className="input" defaultValue="">
            <option value="">{T.roleLater}</option>
            {grantable.map((r) => <option key={r.id} value={r.id}>{r.name_fa}{r.needs_license ? " *" : ""}</option>)}
          </select></label>
        <label><span className="label">{s.license}</span>
          <input name="license" dir="ltr" className="input" maxLength={40} />
          <span className="text-xs text-muted">{s.licenseHint}</span>
        </label>
        <label><span className="label">{s.note}</span><input name="note" maxLength={200} className="input" /></label>
        <p className="text-xs text-muted sm:col-span-2">{T.inviteNoRole} {s.inviteNote}</p>
        <div className="sm:col-span-2"><SubmitButton className="btn">{s.send}</SubmitButton></div>
      </form>

      <section className="card space-y-2">
        <h2 className="font-bold">{s.pending} ({formatNumber(invites.length, locale)})</h2>
        {invites.length === 0 ? <p className="text-sm text-muted">{s.noPending}</p> : (
          <ul className="divide-y divide-line text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span dir="ltr">{i.email}</span> · {roleName.get(i.role_id) ?? ""} · <span className="text-xs text-muted">{date.format(new Date(i.created_at))}</span></span>
                <form action={revokeInvite}>{hidden}<input type="hidden" name="invite_id" value={i.id} />
                  <button className="btn-ghost py-1 text-xs text-red-700">{s.revoke}</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-bold">{s.members} ({formatNumber(members.length, locale)})</h2>
        {members.length === 0 ? <p className="text-sm text-muted">{s.noMembers}</p> : (
          <ul className="divide-y divide-line text-sm">
            {members.map((m) => {
              const p = m.profile;
              return (
                <li key={m.membership_id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {p?.photo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={mediaUrl(p.photo)} alt="" className="h-12 w-12 rounded-full border border-line object-cover" />
                      : <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">{(m.full_name || m.email).slice(0, 1).toUpperCase()}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {m.full_name || <span dir="ltr">{m.email}</span>}
                        {m.is_me && <span className="ms-1 text-xs text-muted">({s.you})</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {m.full_name && <span dir="ltr">{m.email} · </span>}
                        {m.role_code === "no_access" && m.perms.length === 0 ? T.noAccess : m.role_name}
                        {m.custom && <> · {T.custom}</>} · {T.permCount(formatNumber(m.perms.length, locale))}
                        {m.license_no && <> · <span dir="ltr">{m.license_no}</span></>}
                      </p>
                    </div>
                    <span className={`chip ${m.status === "active" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{s.status[m.status] ?? m.status}</span>
                  </div>

                  <details className="rounded-xl bg-paper p-2">
                    <summary className="cursor-pointer text-sm font-semibold text-brand-700">{T.accessEdit}</summary>
                    <form action={setStaffAccess} className="mt-3 space-y-3">{hidden}
                      <input type="hidden" name="membership_id" value={m.membership_id} />
                      <AccessEditor perms={perms} roleId={m.role_id} current={m.perms}
                        templates={roles.map((r) => ({ id: r.id, name_fa: r.code === "no_access" ? T.noAccess : r.name_fa, permissions: r.permissions, can_grant: r.can_grant }))}
                        labels={{ template: T.template, templateHint: T.templateHint, all: T.all, none: T.none, cannotGrant: T.cannotGrant }}
                        groupNames={T.groups} permNames={permName} />
                      <label className="block max-w-xs"><span className="label">{s.license}</span>
                        <input name="license" dir="ltr" defaultValue={m.license_no ?? ""} className="input py-1.5 text-sm" /></label>
                      <SubmitButton className="btn text-sm">{T.saveAccess}</SubmitButton>
                    </form>
                  </details>

                  <details className="rounded-xl bg-paper p-2">
                    <summary className="cursor-pointer text-sm font-semibold text-brand-700">{T.profile}</summary>
                    {!p ? <p className="mt-2 text-xs text-muted">{T.noProfile}</p> : (
                      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                        {p.expertise && p.expertise.length > 0 && <><dt className="text-muted">{T.expertise}</dt><dd>{p.expertise.map((x) => T.expertiseOpts[x] ?? x).join("، ")}</dd></>}
                        {p.education && <><dt className="text-muted">{T.education}</dt><dd className="whitespace-pre-line">{p.education}</dd></>}
                        {p.experience && <><dt className="text-muted">{T.experience}</dt><dd className="whitespace-pre-line">{p.experience}</dd></>}
                        {p.council_no && <><dt className="text-muted">{T.council}</dt><dd dir="ltr">{p.council_no}</dd></>}
                        {p.phone && <><dt className="text-muted">{T.phone}</dt><dd dir="ltr">{p.phone}</dd></>}
                        {p.bio && <><dt className="text-muted">{T.bio}</dt><dd className="whitespace-pre-line">{p.bio}</dd></>}
                      </dl>
                    )}
                  </details>

                  <div className="flex flex-wrap items-center gap-2">
                    <form action={updateStaff}>{hidden}
                      <input type="hidden" name="membership_id" value={m.membership_id} />
                      <input type="hidden" name="act" value={m.status === "active" ? "disable" : "enable"} />
                      <SubmitButton className="btn-ghost py-1 text-xs">{m.status === "active" ? s.disable : s.enable}</SubmitButton>
                    </form>
                    <form action={updateStaff}>{hidden}
                      <input type="hidden" name="membership_id" value={m.membership_id} />
                      <input type="hidden" name="act" value="remove" />
                      <button className="btn-ghost py-1 text-xs text-red-700">{s.remove}</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
