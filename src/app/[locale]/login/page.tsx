import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { isLocale, resolveLocale } from "@/i18n";
import { isConfigured, SITE_URL } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { getLookTexts } from "@/i18n/dictionaries/look";

function ctx(formData: FormData) {
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const n = String(formData.get("next") ?? "");
  const next = n.startsWith("/") && !n.startsWith("//") ? n : `/${locale}/account`;
  return { locale, next };
}

async function signInWithPassword(formData: FormData) {
  "use server";
  const { locale, next } = ctx(formData);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (error) redirect(`/${locale}/login?error=${error.status === 429 ? "rate" : "password"}`);
  redirect(next);
}

async function sendLink(formData: FormData) {
  "use server";
  const { locale, next } = ctx(formData);
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/${locale}/login?error=email`);
  const origin = (await headers()).get("origin") ?? SITE_URL;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) redirect(`/${locale}/login?error=${error.status === 429 ? "rate" : "send"}`);
  redirect(`/${locale}/login?sent=1`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { t } = await resolveLocale(params);
  return { title: t.login.title };
}

export default async function LoginPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const sp = await searchParams;
  const next = sp.next ?? `/${locale}/account`;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold">{t.login.title}</h1>
      <p className="rounded-xl bg-brand-50 p-3 text-sm leading-6 text-brand-800">{getLookTexts(locale).login.registerNote}</p>
      {sp.sent && <OkBox message={t.login.sent} />}
      {sp.error && <ErrorBox message={t.login.errors[sp.error] ?? t.login.errors.send} />}

      <div className="card space-y-3">
        <h2 className="font-bold">{t.login.passwordTitle}</h2>
        <form action={signInWithPassword} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="label" htmlFor="pw-email">{t.login.email}</label>
            <input id="pw-email" name="email" type="email" dir="ltr" required className="input" autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">{t.login.password}</label>
            <input id="password" name="password" type="password" dir="ltr" required className="input" autoComplete="current-password" />
          </div>
          <button className="btn w-full">{t.login.submit}</button>
        </form>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold">{t.login.linkTitle}</h2>
        <p className="text-sm text-muted">{t.login.linkBody}</p>
        <form action={sendLink} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="next" value={next} />
          <input name="email" type="email" dir="ltr" required className="input" placeholder="name@example.com" aria-label={t.login.email} />
          <button className="btn-ghost w-full">{t.login.sendLink}</button>
        </form>
      </div>
    </div>
  );
}
