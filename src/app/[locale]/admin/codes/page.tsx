import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { CodeReview } from "@/components/CodeReview";
import { SetupNotice } from "@/components/SetupNotice";
import { formatNumber, resolveLocale } from "@/i18n";
import { getRules } from "@/i18n/dictionaries/rules";
import { getToolTexts } from "@/i18n/dictionaries/tools";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Row = { id: string; code: string; product_name: string; product_gtin: string | null; pharmacy_name: string | null; created_at: string; agree: number; conflicts: number };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getToolTexts(locale).codes.title, robots: { index: false } };
}

// Dorva panel › barcodes suggested by pharmacies (always reviewed by Dorva).
export default async function AdminCodes({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/codes`);
  const C = getToolTexts(locale).codes;
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  if (!((perms as string[] | null) ?? []).includes("catalog.publish")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const { data } = await supabase.rpc("code_suggestions");
  const rows = (data as Row[]) ?? [];
  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="codes" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{C.title} ({formatNumber(rows.length, locale)})</h1>
      <p className="max-w-3xl text-sm text-muted">{C.intro}</p>
      <a className="btn-ghost inline-flex text-sm" href="/api/admin/codes-export">{C.export}</a>
      <section className="card">
        <CodeReview texts={C as unknown as Record<string, string>} rows={rows.map((r) => ({
          id: r.id, code: r.code, product: r.product_name, catalogGtin: r.product_gtin ?? "", pharmacy: r.pharmacy_name ?? "—",
          agree: r.agree, conflicts: r.conflicts,
          when: new Date(r.created_at).toLocaleString(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" }),
        }))} />
      </section>
    </div>
  );
}
