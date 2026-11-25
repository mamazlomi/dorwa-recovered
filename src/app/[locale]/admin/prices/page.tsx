import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { BulkGrid, type GridRowData } from "@/components/BulkGrid";
import { PriceRequests } from "@/components/PriceRequests";
import { SetupNotice } from "@/components/SetupNotice";
import { formatMoney, formatNumber, localized, resolveLocale } from "@/i18n";
import { getBulkTexts } from "@/i18n/dictionaries/bulk";
import { getRules } from "@/i18n/dictionaries/rules";
import { saveProducts } from "@/lib/bulkActions";
import { getHubTexts } from "@/i18n/dictionaries/hub";
import { getCatalogSyncTexts } from "@/i18n/dictionaries/catalogSync";
import { catNamer } from "@/lib/catNames";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Row = {
  id: string; name_fa: string; name_i18n?: I18n; cls: string; path?: string[]; brand?: string; maker?: string;
  src: string; complete?: boolean; missing?: string[]; code?: string; irc?: string; gtin?: string;
  pub: boolean; price?: number; policy: string; pcap?: number; cap: number; cap_src: string; stock: number;
  min?: number; maxq?: number; comm?: number; comm_eff: number; tech?: boolean; tech_eff: boolean; badge?: string;
  pappr?: boolean; pappr_eff: boolean;
};
type Req = {
  stock_id: string; pharmacy_name: string; city_name: string | null; product_name: string; base_price: number | null;
  current_price: number | null; requested: number; requested_at: string;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getHubTexts(locale).title, robots: { index: false } };
}

// Dorva panel › prices & publishing: every product's Dorva price, price policy,
// publishing and own discount cap, edited in bulk; plus pharmacy price requests.
export default async function AdminPrices({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/prices`);
  const B = getBulkTexts(locale);
  const P = B.prices;
  const H = getHubTexts(locale);
  const G = getCatalogSyncTexts(locale).gap;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const mine = new Set((perms as string[] | null) ?? []);
  if (!mine.has("catalog.publish") && !mine.has("policy.manage")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{P.noAccess}</p></div>;
  }
  const [{ data: rowsData }, { data: reqData }] = await Promise.all([
    supabase.rpc("admin_products"),
    mine.has("policy.manage") ? supabase.rpc("price_requests") : Promise.resolve({ data: [] }),
  ]);
  const rows = (rowsData as Row[] | null) ?? [];
  const { data: badgeData } = await supabase.from("product_badges").select("code, label").eq("is_active", true).order("sort");
  const badges = Object.fromEntries(((badgeData as { code: string; label: I18n }[] | null) ?? []).map((b) => [b.code, b.label[locale] ?? b.label.fa ?? b.code]));
  const reqs = (reqData as Req[]) ?? [];
  const cat = await catNamer(locale);
  const name = (r: { name_fa: string; name_i18n?: I18n }) => localized(r.name_fa, r.name_i18n ?? {}, locale);
  const toman = (rial: number | null) => (rial ? String(Math.round(Number(rial) / 10)) : "");
  const pct = (n: number) => `${formatNumber(Number(n), locale)}٪`;

  const gridRows: GridRowData[] = rows.map((r) => {
    const path = r.path ?? [];
    const gaps = r.complete === false || (r.src === "api" && r.complete == null) ? (r.missing ?? []) : [];
    return {
      id: r.id, title: name(r), href: `/${locale}/product/${r.id}`,
      sub: [t.dispensing[r.cls] ?? r.cls, path.map(cat).join(" › "), r.brand, r.code].filter(Boolean).join(" · "),
      note: r.src === "api" && r.complete === false ? `${H.incomplete}: ${gaps.map((g) => G[g] ?? g).join("، ")}` : r.cls === "rx" ? t.dispensing.rx : undefined,
      search: [r.code, r.irc, r.gtin, r.brand, r.maker].filter(Boolean).join(" "),
      values: {
        published: r.pub, price: toman(r.price ?? null), policy: r.policy, cap: r.pcap == null ? "" : String(Number(r.pcap)),
        min: toman(r.min ?? null), maxq: r.maxq == null ? "" : String(r.maxq), comm: r.comm == null ? "" : String(Number(r.comm)),
        tech: r.tech == null ? "" : String(r.tech), badge: r.badge ?? "", pappr: r.pappr == null ? "" : String(r.pappr),
      },
      info: {
        effCap: `${pct(r.cap)} (${P.capSource[r.cap_src] ?? r.cap_src})`, pharmacies: formatNumber(r.stock, locale),
        commEff: pct(r.comm_eff), techEff: r.tech_eff ? H.techEff.yes : H.techEff.no,
        codes: [r.irc && `IRC ${r.irc}`, r.gtin && `GTIN ${r.gtin}`].filter(Boolean).join(" · "),
      },
      tags: {
        cls: r.cls, cat: path[0] ?? "", sub: path[1] ?? "", brand: r.brand ?? "", maker: r.maker ?? "", pub: r.pub ? "1" : "0",
        owner: r.policy === "fixed" ? "dorva" : "pharmacy", src: r.src, comp: r.src !== "api" ? "" : r.complete ? "yes" : "no", gap: gaps.join("|"),
        price: r.price ? "yes" : "no", stock: r.stock > 0 ? "yes" : "no", badge: r.badge ?? "", tech: r.tech_eff ? "yes" : "no",
      },
    };
  });
  const opts = (xs: string[], label: (x: string) => string = (x) => x) => Object.fromEntries([...new Set(xs.filter(Boolean))].sort().map((x) => [x, label(x)]));

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="prices" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{H.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{H.intro}</p>

      {mine.has("policy.manage") && (
        <section id="requests" className="card space-y-3">
          <h2 className="font-bold">{B.requests.title} ({formatNumber(reqs.length, locale)})</h2>
          <p className="max-w-3xl text-xs text-muted">{B.requests.intro}</p>
          <PriceRequests texts={B.requests} rows={reqs.map((r) => {
            const cur = Number(r.current_price ?? r.base_price ?? 0), req = Number(r.requested);
            const ch = cur ? Math.round(((req - cur) / cur) * 1000) / 10 : 0;
            return {
              id: r.stock_id, pharmacy: `${r.pharmacy_name}${r.city_name ? ` — ${r.city_name}` : ""}`, product: r.product_name,
              current: r.current_price ? formatMoney(r.current_price, locale) : "—", requested: formatMoney(req, locale),
              dorva: r.base_price ? formatMoney(r.base_price, locale) : "—",
              change: cur ? `${ch > 0 ? "+" : ""}${formatNumber(ch, locale)}٪` : "—", up: ch > 0,
              when: new Date(r.requested_at).toLocaleString(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" }),
            };
          })} />
        </section>
      )}

      <section className="card">
        <BulkGrid rows={gridRows} texts={{ ...B.grid, columns: H.columns, clearFilters: H.clearFilters }} errors={{ ...B.errors, ...H.errors }} save={saveProducts}
          canEdit={mine.has("catalog.publish") || mine.has("policy.manage")}
          storageKey="dorva.hub.cols" defaultHidden={["min", "comm", "commEff", "codes", "techEff"]}
          initialFilters={Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && ["cls", "cat", "sub", "brand", "maker", "pub", "owner", "src", "comp", "gap", "price", "stock", "badge", "tech"].includes(k)) as [string, string][])}
          cols={[
            { key: "published", label: P.published, kind: "bool" },
            { key: "price", label: P.price, kind: "number", min: 1, placeholder: P.noPrice },
            { key: "policy", label: H.policy, kind: "select", options: H.policies },
            { key: "pappr", label: H.pappr, kind: "select", options: H.papprOpts },
            { key: "cap", label: P.cap, kind: "number", min: 0, max: 100, step: 0.5, placeholder: P.capPh, nullable: true },
            { key: "min", label: H.min, kind: "number", min: 1, placeholder: H.minPh, nullable: true },
            { key: "maxq", label: H.maxq, kind: "number", min: 1, max: 999, placeholder: H.maxqPh, nullable: true },
            { key: "comm", label: H.comm, kind: "number", min: 0, max: 100, step: 0.5, placeholder: H.commPh, nullable: true },
            { key: "tech", label: H.tech, kind: "select", options: H.techOpts },
            { key: "badge", label: H.badge, kind: "select", options: { "": H.noBadge, ...badges } },
          ]}
          infos={[{ key: "effCap", label: P.effCap }, { key: "pharmacies", label: H.stock }, { key: "commEff", label: H.commEff },
            { key: "techEff", label: H.tech }, { key: "codes", label: H.codes }]}
          filters={[
            { key: "src", label: H.fSrc, options: H.src },
            { key: "cls", label: P.fClass, options: opts(rows.map((r) => r.cls), (x) => t.dispensing[x] ?? x) },
            { key: "cat", label: P.fCat, options: opts(rows.map((r) => r.path?.[0] ?? ""), cat) },
            { key: "sub", label: H.fSub, options: opts(rows.map((r) => r.path?.[1] ?? ""), cat) },
            { key: "brand", label: P.fBrand, options: opts(rows.map((r) => r.brand ?? "")) },
            { key: "maker", label: H.fMaker, options: opts(rows.map((r) => r.maker ?? "")) },
            { key: "pub", label: P.fPub, options: { "1": P.pubYes, "0": P.pubNo } },
            { key: "owner", label: H.fOwner, options: H.owner },
            { key: "price", label: H.fPrice, options: H.price },
            { key: "stock", label: H.fStock, options: H.stockF },
            { key: "comp", label: H.fComp, options: H.comp },
            { key: "gap", label: H.fGap, options: opts(rows.flatMap((r) => r.missing ?? []), (g) => G[g] ?? g) },
            { key: "tech", label: H.fTech, options: H.techF },
            { key: "badge", label: H.fBadge, options: badges },
          ]}
          actions={[
            ...(mine.has("catalog.publish") ? [
              { key: "pub", label: P.a_pub, col: "published", op: "on" as const },
              { key: "unpub", label: P.a_unpub, col: "published", op: "off" as const },
              { key: "price", label: P.a_price, col: "price", op: "set" as const, placeholder: P.ph_price },
              { key: "pricePct", label: P.a_pricePct, col: "price", op: "pct" as const, placeholder: P.ph_pct },
              { key: "policy", label: P.a_policy, col: "policy", op: "pick" as const },
              { key: "min", label: H.a_min, col: "min", op: "set" as const, placeholder: P.ph_price },
              { key: "minClear", label: H.a_minClear, col: "min", op: "clear" as const },
              { key: "maxq", label: H.a_maxq, col: "maxq", op: "set" as const, placeholder: H.ph_maxq },
              { key: "maxqClear", label: H.a_maxqClear, col: "maxq", op: "clear" as const },
              { key: "tech", label: H.a_tech, col: "tech", op: "pick" as const },
              { key: "badge", label: H.a_badge, col: "badge", op: "pick" as const },
            ] : []),
            ...(mine.has("policy.manage") ? [
              { key: "cap", label: P.a_cap, col: "cap", op: "set" as const, placeholder: P.ph_cap },
              { key: "capClear", label: P.a_capClear, col: "cap", op: "clear" as const },
              { key: "pappr", label: H.a_pappr, col: "pappr", op: "pick" as const },
              { key: "comm", label: H.a_comm, col: "comm", op: "set" as const, placeholder: H.ph_comm },
              { key: "commClear", label: H.a_commClear, col: "comm", op: "clear" as const },
            ] : []),
          ]} />
      </section>
    </div>
  );
}
