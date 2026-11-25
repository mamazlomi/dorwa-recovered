import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/i18n/config";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { isUuid } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";

type Hist = { action: string; note: string | null; at: string; by_dorva: boolean };

async function resubmit(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/pharmacy/dashboard`);
  const f = (k: string) => String(formData.get(k) ?? "").trim();
  const { data, error } = await (await createClient()).rpc("pharmacy_resubmit", {
    p_pharmacy: id,
    p: { name_fa: f("name_fa"), license_no: f("license_no"), technical_officer_name: f("officer"),
      technical_officer_license: f("officer_license"), message: f("message") },
  });
  const r = error ? (error.code === "42501" ? "forbidden" : "unknown") : String(data);
  revalidatePath(`/${locale}/pharmacy/dashboard`);
  redirect(`/${locale}/pharmacy/dashboard?ph=${id}&review=${r}`);
}

/** Shown on the pharmacy dashboard while the pharmacy is pending or rejected. */
export async function ReviewStatus({ locale, pharmacy, status, reason, canEdit, result }: {
  locale: "fa" | "en" | "ar"; pharmacy: string; status: string; reason: string | null; canEdit: boolean; result?: string;
}) {
  const T = getRound5Texts(locale);
  const D = T.dash;
  if (status !== "pending" && status !== "rejected" && !result) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("pharmacy_review_history", { p_pharmacy: pharmacy });
  const hist = (data as Hist[] | null) ?? [];
  const when = (s: string) => new Date(s).toLocaleString(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const msg = result ? D.results[result] ?? D.results.unknown : null;

  return (
    <section className={`card space-y-3 ${status === "rejected" ? "border-red-300" : "border-brand-300"}`}>
      {msg && <p role="status" className={`text-sm ${result === "ok" ? "text-brand-700" : "text-red-700"}`}>{msg}</p>}
      {status === "pending" && (
        <>
          <h2 className="font-bold">{D.pendingTitle}</h2>
          <p className="text-sm text-muted">{D.pendingBody}</p>
        </>
      )}
      {status === "rejected" && (
        <>
          <h2 className="font-bold text-red-700">{D.rejectedTitle}</h2>
          {reason && <p className="whitespace-pre-line rounded-lg bg-red-50 p-3 text-sm"><b>{D.reason}:</b> {reason}</p>}
          {canEdit && (
            <form action={resubmit} className="space-y-3">
              <p className="text-xs text-muted">{D.fixHelp}</p>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={pharmacy} />
              <div className="grid gap-2 sm:grid-cols-2">
                <label><span className="label">{D.name}</span><input name="name_fa" maxLength={120} className="input" /></label>
                <label><span className="label">{D.license}</span><input name="license_no" dir="ltr" maxLength={40} className="input" /></label>
                <label><span className="label">{D.officer}</span><input name="officer" maxLength={80} className="input" /></label>
                <label><span className="label">{D.officerLicense}</span><input name="officer_license" dir="ltr" maxLength={30} className="input" /></label>
              </div>
              <label className="block"><span className="label">{D.message}</span>
                <textarea name="message" required minLength={3} maxLength={1000} rows={3} className="input" /></label>
              <button type="submit" className="btn">{D.send}</button>
            </form>
          )}
        </>
      )}
      {hist.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{D.history}</summary>
          <ul className="mt-2 space-y-1">
            {hist.map((x, i) => (
              <li key={i} className="rounded-lg bg-paper p-2">
                <b>{T.review.actions[x.action] ?? x.action}</b> — <span className="text-muted">{when(x.at)}</span>
                {x.note && <p className="mt-1 whitespace-pre-line">{x.note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
