import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { isLocale } from "@/i18n/config";
import { getDiscountTexts } from "@/i18n/dictionaries/discounts";
import { getFilterTexts } from "@/i18n/dictionaries/filters";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import { getStaffTexts } from "@/i18n/dictionaries/staff";
import { getDashboardTexts } from "@/i18n/dictionaries/dashboard";
import { getFinderTexts } from "@/i18n/dictionaries/finder";
import { getStudioTexts } from "@/i18n/dictionaries/studio";
import { getPageTexts } from "@/i18n/dictionaries/pages";
import { getToolTexts } from "@/i18n/dictionaries/tools";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { getRound6Texts } from "@/i18n/dictionaries/round6";
import { getSeoTexts } from "@/i18n/dictionaries/seo";
import { getNotifyTexts } from "@/i18n/dictionaries/notify";
import { getCatalogSyncTexts } from "@/i18n/dictionaries/catalogSync";
import { getSnapshotTexts } from "@/i18n/dictionaries/snapshots";
import { getConsultTexts } from "@/i18n/dictionaries/consult";

type Tab = "dashboard" | "pharmacies" | "settings" | "discounts" | "filters" | "collections" | "shipping" | "complements" | "staff" | "finder" | "pages" | "theme" | "lists" | "prices" | "codes" | "pharmacists" | "inbox" | "seo" | "notifications" | "catalog" | "snapshots" | "consult";

// a tab shows only to people holding one of these permissions (the pages check again)
const NEEDS: Record<Tab, string[]> = {
  dashboard: [], pharmacies: ["pharmacy.read_all", "pharmacy.approve"], settings: ["settings.manage", "pharmacy.read_all"],
  theme: ["theme.manage"], pages: ["pages.manage"], discounts: ["policy.manage"], filters: ["settings.manage", "pharmacy.read_all"],
  collections: ["collections.manage", "pharmacy.read_all"], finder: ["finder.manage", "pharmacy.read_all"], complements: ["collections.manage"],
  shipping: ["settings.manage", "pharmacy.read_all"], staff: ["platform.roles.manage"], lists: ["settings.manage"], prices: ["catalog.publish", "policy.manage"], codes: ["catalog.publish"], pharmacists: ["pharmacy.read_all"], inbox: [], seo: ["settings.manage"], notifications: ["settings.manage"], catalog: ["settings.manage", "catalog.publish"], snapshots: ["settings.manage"], consult: ["consult.manage"],
};

export async function AdminTabs({ locale, current, labels }: {
  locale: string;
  current: Tab;
  labels: { tabPharmacies: string; tabSettings: string };
}) {
  const l = isLocale(locale) ? locale : "fa";
  const discounts = getDiscountTexts(l).tab;
  const filters = getFilterTexts(l).tab;
  const collections = getCollectionTexts(l).tab;
  const lg = getLogisticsTexts(l);
  const supabase = await createClient();
  const [{ data: permData }, { data: inboxData }] = await Promise.all([
    supabase.rpc("my_platform_permissions"),
    supabase.rpc("approval_inbox"),
  ]);
  const mine = new Set((permData as string[] | null) ?? []);
  const waiting = Object.values((inboxData as Record<string, number> | null) ?? {}).reduce((a, n) => a + Number(n || 0), 0);
  const tab = (key: Tab, label: string, badge = 0) => (NEEDS[key].length > 0 && !NEEDS[key].some((p) => mine.has(p)) && key !== current) ? null : (
    <Link
      href={`/${locale}/admin/${key}`}
      aria-current={current === key ? "page" : undefined}
      className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm md:px-4 ${current === key ? "bg-brand-700 text-white" : "border border-line bg-surface hover:bg-brand-50 md:border-0 md:bg-transparent"}`}
    >
      {label}
      {badge > 0 && <span className="ms-1.5 inline-grid min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{badge}</span>}
    </Link>
  );
  return (
    // phones: one swipeable row instead of six wrapped rows; wider screens wrap as before
    <nav className="-mx-4 mb-6 flex gap-2 overflow-x-auto border-b border-line px-4 pb-3 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {tab("inbox", getRound6Texts(l).inbox.tab, waiting)}
      {tab("dashboard", getDashboardTexts(l).adminTab)}
      {tab("prices", getRound5Texts(l).tabs.products)}
      {tab("pharmacies", labels.tabPharmacies)}
      {tab("pharmacists", getRound5Texts(l).tabs.bank)}
      {tab("codes", getToolTexts(l).codes.tab)}
      {tab("catalog", getCatalogSyncTexts(l).tab)}
      {tab("snapshots", getSnapshotTexts(l).tab)}
      {tab("settings", labels.tabSettings)}
      {tab("notifications", getNotifyTexts(l).admin.tab)}
      {tab("consult", getConsultTexts(l).adminTab)}
      {tab("seo", getSeoTexts(l).tab)}
      {tab("theme", getStudioTexts(l).title)}
      {tab("pages", getPageTexts(l).adminTab)}
      {tab("discounts", discounts)}
      {tab("filters", filters)}
      {tab("collections", collections)}
      {tab("finder", getFinderTexts(l).adminTab)}
      {tab("complements", lg.compTab)}
      {tab("shipping", lg.adminTab)}
      {tab("staff", getStaffTexts(l).adminTab)}
      {tab("lists", getProfileTexts(l).listsTab)}
    </nav>
  );
}
