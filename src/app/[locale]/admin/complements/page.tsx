import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getLogisticsTexts } from "@/i18n/dictionaries/logistics";
import { getRules } from "@/i18n/dictionaries/rules";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Rule = {
  id: string; source_path: string[]; target_path: string[]; kind: "suggest" | "never"; status: string;
  sort: number; note: string | null; origin: string;
};
type Pair = { product_id: string; complement_id: string; kind: string; sort: number };
const SEP = " › ";
const STATUS_ORDER: Record<string, number> = { proposed: 0, active: 1, off: 2 };

const ctx = (f: FormData) => {
  const r = String(f.get("locale") ?? "fa");
  const locale = isLocale(r) ? r : "fa";
  const back = String(f.get("back") ?? "");
  const go = (q: string) => redirect(`${back.startsWith(`/${locale}/admin/complements`) ? back : `/${locale}/admin/complements`}${back.includes("?") ? "&" : "?"}${q}`);
  return { go };
};
const path = (v: FormDataEntryValue | null) => String(v ?? "").split(SEP).map((s) => s.trim()).filter(Boolean).slice(0, 3);

async function addRule(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const source = path(formData.get("source")), target = path(formData.get("target"));
  if (!source.length || !target.length) go("err=1");
  const supabase = await createClient();
  const { error } = await supabase.from("complement_rules").upsert({
    source_path: source, target_path: target, kind: formData.get("kind") === "never" ? "never" : "suggest",
    status: "active", origin: "admin", sort: Number(formData.get("sort") ?? 100) || 100,
    note: String(formData.get("note") ?? "").trim().slice(0, 200) || null, updated_at: new Date().toISOString(),
  }, { onConflict: "source_path,target_path,kind" });
  go(error ? "err=1" : "ok=1");
}
async function setStatus(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const id = formData.get("id");
  const status = String(formData.get("status"));
  if (!isUuid(id) || !["active", "off"].includes(status)) go("err=1");
  const supabase = await createClient();
  const { error } = await supabase.from("complement_rules").update({ status, updated_at: new Date().toISOString() }).eq("id", id as string);
  go(error ? "err=1" : "ok=1");
}
async function removeRule(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const id = formData.get("id");
  if (!isUuid(id)) go("err=1");
  const supabase = await createClient();
  const { error } = await supabase.from("complement_rules").delete().eq("id", id as string);
  go(error ? "err=1" : "ok=1");
}
async function addPair(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const a = formData.get("product_id"), b = formData.get("complement_id");
  if (!isUuid(a) || !isUuid(b) || a === b) go("err=1");
  const supabase = await createClient();
  const { error } = await supabase.from("product_complements").upsert({
    product_id: a, complement_id: b, kind: formData.get("kind") === "never" ? "never" : "suggest",
    sort: Number(formData.get("sort") ?? 100) || 100, updated_at: new Date().toISOString(),
  }, { onConflict: "product_id,complement_id" });
  go(error ? "err=1" : "ok=1");
}
async function removePair(formData: FormData) {
  "use server";
  const { go } = ctx(formData);
  const a = formData.get("product_id"), b = formData.get("complement_id");
  if (!isUuid(a) || !isUuid(b)) go("err=1");
  const supabase = await createClient();
  const { error } = await supabase.from("product_complements").delete().eq("product_id", a as string).eq("complement_id", b as string);
  go(error ? "err=1" : "ok=1");
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getLogisticsTexts(locale).compTitle, robots: { index: false } };
}

export default async function AdminComplementsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ ok?: string; err?: string; st?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const L = getLogisticsTexts(locale);
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/complements`);
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  if (!((perms as string[] | null) ?? []).includes("collections.manage")) {
    return <div className="card max-w-xl"><h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1><p className="text-sm text-muted">{t.admin.noAccessBody}</p></div>;
  }
  const sp = await searchParams;
  const st = ["proposed", "active", "off"].includes(sp.st ?? "") ? sp.st! : null;

  const [{ data: rulesData }, { data: pairsData }, { data: prodData }] = await Promise.all([
    supabase.from("complement_rules").select("id, source_path, target_path, kind, status, sort, note, origin").order("sort"),
    supabase.from("product_complements").select("product_id, complement_id, kind, sort").order("sort"),
    supabase.from("catalog_products").select("id, name_fa, name_i18n, category_path, dispensing_class").eq("is_active", true).order("name_fa"),
  ]);
  const rules = ((rulesData as Rule[]) ?? []).sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.sort - b.sort);
  const shown = st ? rules.filter((r) => r.status === st) : rules;
  const pairs = (pairsData as Pair[]) ?? [];
  const products = (prodData as { id: string; name_fa: string; name_i18n: I18n; category_path: string[]; dispensing_class: string }[]) ?? [];
  const nonRx = products.filter((p) => p.dispensing_class !== "rx");
  const pname = new Map(products.map((p) => [p.id, localized(p.name_fa, p.name_i18n, locale)]));
  // category choices: level 1 and level 1 › 2
  const cats = [...new Set(products.filter((p) => p.dispensing_class !== "rx").flatMap((p) =>
    [p.category_path.slice(0, 1), p.category_path.slice(0, 2)].filter((x) => x.length).map((x) => x.join(SEP))))].sort((a, b) => a.localeCompare(b, "fa"));
  const count = (s: string) => rules.filter((r) => r.status === s).length;
  const self = `/${locale}/admin/complements${st ? `?st=${st}` : ""}`;
  const hidden = (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="back" value={self} /></>);
  const fmt = (n: number) => formatNumber(n, locale);

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="complements" labels={getRules(locale)} />
      <h1 className="text-2xl font-extrabold">{L.compTitle}</h1>
      <p className="max-w-3xl text-sm text-muted">{L.compIntro}</p>
      <p className="max-w-3xl rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{L.proposedNote}</p>
      {sp.ok && <OkBox message="✓" />}
      {sp.err && <ErrorBox message={t.dashboard.errors.unknown} />}

      <form action={addRule} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        {hidden}
        <h2 className="font-bold sm:col-span-4">{L.addRule}</h2>
        <label><span className="label">{L.source}</span>
          <select name="source" required className="input">{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label><span className="label">{L.target}</span>
          <select name="target" required className="input">{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label><span className="label">{L.kind}</span>
          <select name="kind" className="input"><option value="suggest">{L.kindSuggest}</option><option value="never">{L.kindNever}</option></select></label>
        <label><span className="label">{L.sort}</span><input name="sort" type="number" defaultValue={100} className="input w-24" dir="ltr" /></label>
        <label className="sm:col-span-3"><span className="label">{L.note}</span><input name="note" maxLength={200} className="input" /></label>
        <SubmitButton className="btn">{L.add}</SubmitButton>
      </form>

      <section className="card space-y-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/${locale}/admin/complements`} className={`chip ${!st ? "bg-brand-600 text-white" : ""}`}>{L.filterAll} ({fmt(rules.length)})</Link>
          {(["proposed", "active", "off"] as const).map((s) => (
            <Link key={s} href={`/${locale}/admin/complements?st=${s}`} className={`chip ${st === s ? "bg-brand-600 text-white" : ""}`}>{L.statuses[s]} ({fmt(count(s))})</Link>
          ))}
        </div>
        {shown.length === 0 ? <p className="text-sm text-muted">{L.noRules}</p> : (
          <ul className="divide-y divide-line text-sm">
            {shown.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 space-y-0.5">
                  <p>
                    <span className="font-medium">{r.source_path.join(SEP)}</span>
                    <span className={`mx-2 chip ${r.kind === "never" ? "bg-red-50 text-red-700" : ""}`}>{r.kind === "never" ? L.kindNever : "←"}</span>
                    <span className="font-medium">{r.target_path.join(SEP)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {L.statuses[r.status]} · {L.origin[r.origin] ?? r.origin} · {L.sort} {fmt(r.sort)}{r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {r.status !== "active" && (
                    <form action={setStatus}>{hidden}<input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="active" />
                      <SubmitButton className="btn py-1 text-xs">{r.status === "proposed" ? L.approve : L.turnOn}</SubmitButton></form>
                  )}
                  {r.status !== "off" && (
                    <form action={setStatus}>{hidden}<input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="off" />
                      <SubmitButton className="btn-ghost py-1 text-xs">{L.turnOff}</SubmitButton></form>
                  )}
                  <form action={removeRule}>{hidden}<input type="hidden" name="id" value={r.id} />
                    <button className="btn-ghost py-1 text-xs text-red-700">{L.remove}</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold">{L.pairsTitle}</h2>
        <p className="text-xs text-muted">{L.pairsIntro}</p>
        <form action={addPair} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          {hidden}
          <label><span className="label">{L.product}</span>
            <select name="product_id" required className="input">{nonRx.map((p) => <option key={p.id} value={p.id}>{pname.get(p.id)}</option>)}</select></label>
          <label><span className="label">{L.complement}</span>
            <select name="complement_id" required className="input">{nonRx.map((p) => <option key={p.id} value={p.id}>{pname.get(p.id)}</option>)}</select></label>
          <label><span className="label">{L.kind}</span>
            <select name="kind" className="input"><option value="suggest">{L.kindSuggest}</option><option value="never">{L.kindNever}</option></select></label>
          <SubmitButton className="btn">{L.add}</SubmitButton>
        </form>
        {pairs.length === 0 ? <p className="text-sm text-muted">{L.noPairs}</p> : (
          <ul className="divide-y divide-line text-sm">
            {pairs.map((p) => (
              <li key={`${p.product_id}-${p.complement_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {pname.get(p.product_id) ?? p.product_id}
                  <span className={`mx-2 chip ${p.kind === "never" ? "bg-red-50 text-red-700" : ""}`}>{p.kind === "never" ? L.kindNever : "←"}</span>
                  {pname.get(p.complement_id) ?? p.complement_id}
                </span>
                <form action={removePair}>{hidden}
                  <input type="hidden" name="product_id" value={p.product_id} /><input type="hidden" name="complement_id" value={p.complement_id} />
                  <button className="btn-ghost py-1 text-xs text-red-700">{L.remove}</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
