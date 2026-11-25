import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { getRules } from "@/i18n/dictionaries/rules";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Row = {
  id: string; slug: string; name_fa: string; name_i18n: I18n; license_no: string; status: string; is_virtual: boolean;
  technical_officer_name: string | null; technical_officer_license: string | null; created_at: string; review_note: string | null;
  cities: { name_fa: string; name_i18n: I18n } | null;
};
type Hist = { action: string; note: string | null; at: string; by_dorva: boolean };

// Each decision is its own server action: the old shared form read the pressed
// button's value, which could arrive empty and was then saved as "reject".
const back = (formData: FormData) => {
  const raw = String(formData.get("locale") ?? "fa");
  return isLocale(raw) ? raw : "fa";
};
const done = (locale: string, error: string | null, ok: string) => {
  revalidatePath(`/${locale}/admin/pharmacies`);
  redirect(`/${locale}/admin/pharmacies?${error ? `error=${encodeURIComponent(error)}` : `ok=${ok}`}`);
};

async function approve(formData: FormData) {
  "use server";
  const locale = back(formData);
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) done(locale, "invalid", "");
  const { error } = await (await createClient()).rpc("review_pharmacy", {
    p_pharmacy: id, p_approve: true, p_note: String(formData.get("note") ?? "").trim() || null,
  });
  done(locale, error ? error.message : null, "approved");
}

async function reject(formData: FormData) {
  "use server";
  const locale = back(formData);
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isUuid(id)) done(locale, "invalid", "");
  if (reason.length < 5) done(locale, getRound5Texts(locale).review.errReason, "");
  const { error } = await (await createClient()).rpc("review_pharmacy", { p_pharmacy: id, p_approve: false, p_note: reason });
  done(locale, error ? (error.message === "reason required" ? getRound5Texts(locale).review.errReason : error.message) : null, "rejected");
}

async function reopen(formData: FormData) {
  "use server";
  const locale = back(formData);
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) done(locale, "invalid", "");
  const { data, error } = await (await createClient()).rpc("pharmacy_reopen", { p_pharmacy: id, p_note: null });
  done(locale, error ? error.message : data !== "ok" ? String(data) : null, "reopened");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { t } = await resolveLocale(params);
  return { title: t.nav.adminPanel };
}

export default async function AdminPharmacies({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/pharmacies`);
  const a = t.admin;
  const R5 = getRound5Texts(locale).review;
  const supabase = await createClient();

  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const permissions = (perms as string[] | null) ?? [];
  if (!permissions.includes("pharmacy.read_all")) {
    return (
      <div className="card max-w-xl">
        <h1 className="mb-2 text-xl font-bold">{a.noAccessTitle}</h1>
        <p className="text-sm text-muted">{a.noAccessBody}</p>
      </div>
    );
  }
  const canApprove = permissions.includes("pharmacy.approve");
  const { error, ok } = await searchParams;

  const { data } = await supabase
    .from("pharmacies")
    .select("id, slug, name_fa, name_i18n, license_no, status, is_virtual, technical_officer_name, technical_officer_license, created_at, review_note, cities(name_fa, name_i18n)")
    .order("created_at", { ascending: false });
  const rows = (data as unknown as Row[]) ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const stopped = rows.filter((r) => r.status === "rejected" || r.status === "suspended");
  const others = rows.filter((r) => r.status !== "pending");
  const name = (x: { name_fa: string; name_i18n: I18n } | null) => (x ? localized(x.name_fa, x.name_i18n, locale) : "");

  const histories = new Map<string, Hist[]>();
  await Promise.all([...pending, ...stopped].slice(0, 60).map(async (r) => {
    const { data: h } = await supabase.rpc("pharmacy_review_history", { p_pharmacy: r.id });
    histories.set(r.id, (h as Hist[] | null) ?? []);
  }));
  const when = (s: string) => new Date(s).toLocaleString(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const History = ({ id }: { id: string }) => {
    const h = histories.get(id) ?? [];
    if (h.length === 0) return null;
    return (
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">{R5.history} ({formatNumber(h.length, locale)})</summary>
        <ul className="mt-2 space-y-1">
          {h.map((x, i) => (
            <li key={i} className="rounded-lg bg-paper p-2">
              <b>{R5.actions[x.action] ?? x.action}</b> — <span className="text-muted">{when(x.at)}</span>
              {x.note && <p className="mt-1 whitespace-pre-line">{x.note}</p>}
            </li>
          ))}
        </ul>
      </details>
    );
  };
  const okText = ok === "approved" ? R5.okApproved : ok === "rejected" ? R5.okRejected : ok === "reopened" ? R5.okReopened : null;

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="pharmacies" labels={getRules(locale)} />
      <h1 className="text-xl font-bold">{a.title}</h1>
      {error && <ErrorBox message={error} />}
      {okText && <OkBox message={okText} />}

      <section className="space-y-3">
        <h2 className="font-bold">{a.pending(formatNumber(pending.length, locale))}</h2>
        {pending.length === 0 && <p className="text-sm text-muted">{a.queueEmpty}</p>}
        {pending.map((r) => {
          const last = (histories.get(r.id) ?? [])[0];
          return (
            <div key={r.id} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">
                    {name(r)}
                    {last?.action === "resubmitted" && <span className="chip ms-2 text-xs">{R5.resubmittedBadge}</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {name(r.cities)} — {a.license}: <span dir="ltr">{r.license_no}</span> — {t.pharmacy.techOfficer}: {r.technical_officer_name}
                    {" "}(<span dir="ltr">{r.technical_officer_license}</span>)
                  </p>
                </div>
                <Link href={`/${locale}/${r.slug}`} className="btn-ghost">{a.preview}</Link>
              </div>
              {last?.action === "resubmitted" && last.note && (
                <p className="rounded-lg bg-brand-50 p-2 text-sm"><b>{R5.lastMessage}:</b> {last.note}</p>
              )}
              {canApprove && (
                <div className="grid gap-3 md:grid-cols-2">
                  <form action={approve} className="space-y-2 rounded-xl border border-line p-3">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={r.id} />
                    <input name="note" className="input" placeholder={R5.approveNote} maxLength={1000} />
                    <button type="submit" className="btn">{R5.approve}</button>
                  </form>
                  <form action={reject} className="space-y-2 rounded-xl border border-red-200 p-3">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={r.id} />
                    <label className="block"><span className="label">{R5.rejectReason}</span>
                      <textarea name="reason" required minLength={5} maxLength={1000} rows={2} className="input" placeholder={R5.rejectPh} /></label>
                    <button type="submit" className="btn-ghost border-red-300 text-red-700">{R5.reject}</button>
                  </form>
                </div>
              )}
              <History id={r.id} />
            </div>
          );
        })}
      </section>

      {stopped.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold">{R5.rejectedTitle} ({formatNumber(stopped.length, locale)})</h2>
          {stopped.map((r) => (
            <div key={r.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{name(r)} <span className="chip ms-1 text-xs">{t.status[r.status]}</span></p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/${locale}/${r.slug}`} className="btn-ghost text-sm">{a.preview}</Link>
                  {canApprove && (
                    <form action={reopen}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="btn-ghost text-sm">{R5.reopen}</button>
                    </form>
                  )}
                </div>
              </div>
              {r.review_note && <p className="text-sm"><b>{R5.lastReason}:</b> {r.review_note}</p>}
              <History id={r.id} />
            </div>
          ))}
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-bold">{a.all}</h2>
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-2 text-start">{a.name}</th>
              <th className="text-start">{a.city}</th>
              <th className="text-start">{t.dashboard.statusLabel}</th>
              <th className="text-start">{a.type}</th>
            </tr>
          </thead>
          <tbody>
            {others.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="py-2"><Link href={`/${locale}/${r.slug}`} className="text-brand-700 hover:underline">{name(r)}</Link></td>
                <td>{name(r.cities)}</td>
                <td>{t.status[r.status]}</td>
                <td>{r.is_virtual ? t.common.virtual : a.real}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
