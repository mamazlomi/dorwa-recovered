import { notFound, redirect } from "next/navigation";
import { SetupNotice } from "@/components/SetupNotice";
import { ThemeStudio } from "@/components/ThemeStudio";
import { resolveLocale } from "@/i18n";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getStudioTexts(locale).title, robots: { index: false } };
}

type Got = { id: string; name: string; config: unknown; draft: unknown | null; is_default: boolean; is_live: boolean };

// The live theme editor: controls on one side, the real site in a frame on the other.
export default async function ThemeEditor({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/theme/${id}`);
  const supabase = await createClient();
  const [{ data, error }, { data: prod }, { data: phs }] = await Promise.all([
    supabase.rpc("theme_get", { p_theme: id }),
    supabase.rpc("shop_search", { p_limit: 1 }),
    supabase.rpc("search_pharmacies", {}),
  ]);
  if (error) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const th = data as Got | null;
  if (!th) notFound();
  const productId = (prod as { product_id: string }[] | null)?.[0]?.product_id ?? null;
  const phSlug = (phs as { slug: string }[] | null)?.[0]?.slug ?? null;

  return (
    <ThemeStudio locale={locale} id={th.id} initialName={th.name} stored={th.draft ?? th.config} isLive={th.is_live}
      pages={{
        home: `/${locale}`, products: `/${locale}/products`,
        ...(productId ? { product: `/${locale}/product/${productId}` } : {}),
        ...(phSlug ? { pharmacy: `/${locale}/${phSlug}` } : {}),
        cart: `/${locale}/cart`, finder: `/${locale}/finder`,
      }}
      texts={getStudioTexts(locale)} />
  );
}
