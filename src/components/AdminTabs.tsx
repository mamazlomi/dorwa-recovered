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
import { getReviewerTexts } from "@/i18n/dictionaries/reviewers";
import { getQualTexts } from "@/i18n/dictionaries/qualification";

type Tab = "dashboard" | "pharmacies" | "settings" | "discounts" | "filters" | "collections" | "shipping" | "complements" | "staff" | "finder" | "pages" | "theme" | "lists" | "prices" | "codes" | "pharmacists" | "inbox" | "seo" | "notifications" | "catalog" | "snapshots" | "consult" | "reviewers" | "experts";

// a tab shows only to people holding one of these permissions (the pages check again)
const NEEDS: Record<Tab, string[]> = {
  dashboard: [], pharmacies: ["pharmacy.read_all", "pharmacy.approve"], settings: ["settings.manage", "pharmacy.read_all"],
  theme: ["theme.manage"], pages: ["pages.manage"], discounts: ["policy.manage"], filters: ["settings.manage", "pharmacy.read_all"],
  collections: ["collections.manage", "pharmacy.read_all"], finder: ["finder.manage", "pharmacy.read_all"], complements: ["collections.manage"],
  shipping: ["settings.manage", "pharmacy.read_all"], staff: ["platform.roles.manage"], lists: ["settings.manage"], prices: ["catalog.publish", "policy.manage"], codes: ["catalog.publish"], pharmacists: ["pharmacy.read_all"], inbox: [], seo: ["settings.manage"], notifications: ["settings.manage"], catalog: ["settings.manage", "catalog.publish"], snapshots: ["settings.manage"], consult: ["consult.manage"], reviewers: ["consult.manage"], experts: ["consult.manage"],
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
  // two levels: a few big sections, then only the tabs of the section you are in
  const CATS: { key: string; tabs: Tab[] }[] = [
    { key: "home", tabs: ["inbox", "dashboard"] },
    { key: "catalog", tabs: ["prices", "catalog", "snapshots", "codes", "collections", "filters", "finder"] },
    { key: "pharmacies", tabs: ["pharmacies", "pharmacists"] },
    { key: "orders", tabs: ["shipping", "complements", "discounts"] },
    { key: "community", tabs: ["consult", "experts", "reviewers"] },
    { key: "site", tabs: ["pages", "theme", "seo", "notifications"] },
    { key: "system", tabs: ["settings", "staff", "lists"] },
  ];
  const LABEL: Record<Tab, string> = {
    inbox: getRound6Texts(l).inbox.tab, dashboard: getDashboardTexts(l).adminTab, prices: getRound5Texts(l).tabs.products,
    pharmacies: labels.tabPharmacies, pharmacists: getRound5Texts(l).tabs.bank, codes: getToolTexts(l).codes.tab,
    catalog: getCatalogSyncTexts(l).tab, snapshots: getSnapshotTexts(l).tab, settings: labels.tabSettings,
    notifications: getNotifyTexts(l).admin.tab, consult: getConsultTexts(l).adminTab, reviewers: getReviewerTexts(l).admin.tab, experts: getQualTexts(l).tab,
    seo: getSeoTexts(l).tab, theme: getStudioTexts(l).title, pages: getPageTexts(l).adminTab, discounts, filters, collections,
    finder: getFinderTexts(l).adminTab, complements: lg.compTab, shipping: lg.adminTab, staff: getStaffTexts(l).adminTab, lists: getProfileTexts(l).listsTab,
  };
  const visible = (k: Tab) => NEEDS[k].length === 0 || NEEDS[k].some((p) => mine.has(p)) || k === current;
  const catOf = CATS.find((c) => c.tabs.includes(current)) ?? CATS[0];
  const catNames = getReviewerTexts(l).adminCats;
  const pill = "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm md:px-4";
  return (
    <div className="mb-6 space-y-2 border-b border-line pb-3">
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {CATS.map((c) => {
          const first = c.tabs.find(visible);
          if (!first) return null;
          const on = c === catOf;
          const badge = c.key === "home" ? waiting : 0;
          return (
            <Link key={c.key} href={`/${locale}/admin/${on ? current : first}`} aria-current={on ? "true" : undefined}
              className={`${pill} font-semibold ${on ? "bg-brand-700 text-white" : "border border-line bg-surface hover:bg-brand-50"}`}>
              {catNames[c.key]}
              {badge > 0 && <span className="ms-1.5 inline-grid min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{badge}</span>}
            </Link>
          );
        })}
      </nav>
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {catOf.tabs.filter(visible).map((k) => (
          <Link key={k} href={`/${locale}/admin/${k}`} aria-current={current === k ? "page" : undefined}
            className={`${pill} ${current === k ? "bg-brand-50 font-bold text-brand-800 ring-1 ring-brand-300" : "text-muted hover:bg-brand-50"}`}>
            {LABEL[k]}
            {k === "inbox" && waiting > 0 && <span className="ms-1.5 inline-grid min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{waiting}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
