import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SubmitButton } from "@/components/SubmitButton";
import { isLocale } from "@/i18n/config";
import { getNotifyTexts } from "@/i18n/dictionaries/notify";
import { createClient } from "@/lib/supabase/server";

async function saveMobile(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const { data, error } = await (await createClient()).rpc("set_my_mobile", { p_mobile: String(formData.get("mobile") ?? "") });
  revalidatePath(`/${locale}/account`);
  redirect(`/${locale}/account?mobile=${error ? "unknown" : String(data)}#mobile`);
}

/** The signed-in person's mobile number, used for SMS notifications. */
export async function MobileForm({ locale, result }: { locale: "fa" | "en" | "ar"; result?: string }) {
  const M = getNotifyTexts(locale).mobile;
  const { data } = await (await createClient()).rpc("my_mobile");
  return (
    <section id="mobile" className="card space-y-2">
      <h2 className="font-bold">{M.title}</h2>
      <p className="text-xs text-muted">{M.help}</p>
      <form action={saveMobile} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="locale" value={locale} />
        <input name="mobile" type="tel" inputMode="tel" dir="ltr" defaultValue={(data as string | null) ?? ""} placeholder="09123456789"
          maxLength={16} className="input max-w-56" aria-label={M.title} />
        <SubmitButton className="btn">{M.save}</SubmitButton>
      </form>
      {result && <p role="status" className={`text-sm ${result === "ok" ? "text-brand-700" : "text-red-700"}`}>{M[result] ?? M.unknown}</p>}
    </section>
  );
}
