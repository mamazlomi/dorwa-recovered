import { StaffAccessNote } from "@/components/StaffAccessNote";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, localized, resolveLocale } from "@/i18n";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { COLLECTION_FIELDS, titleOf, UUID_RE, type CollectionRow } from "@/lib/collections";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type I18n = Record<string, string>;
type Ph = { id: string; slug: string; name_fa: string; name_i18n: I18n; sort_policy: string | null };

const randomSlug = () => `c-${Math.random().toString(36).slice(2, 8)}`;

async function copyCollection(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const ph = String(formData.get("ph") ?? "");
  const source = String(formData.get("source") ?? "");
  if (!UUID_RE.test(ph) || !UUID_RE.test(source)) redirect(`/${locale}/pharmacy/collections`);
  const supabase = await createClient();
  const { data: src } = await supabase.from("collections").select("slug, title").eq("id", source).is("pharmacy_id", null).maybeSingle();
  if (!src) redirect(`/${locale}/pharmacy/collections?ph=${ph}&error=1`);
  let res = await supabase.from("collections").insert({
    pharmacy_id: ph, source_id: source, slug: src.slug, title: src.title, status: "published", featured: true,
  }).select("id").single();
  if (res.error?.code === "23505") {
    res = await supabase.from("collections").insert({
      pharmacy_id: ph, source_id: source, slug: `${src.slug.slice(0, 50)}-${Math.random().toString(36).slice(2, 6)}`,
      title: src.title, status: "published", featured: true,
    }).select("id").single();
  }
  if (res.error || !res.data) redirect(`/${locale}/pharmacy/collections?ph=${ph}&error=1`);
  revalidatePath(`/${locale}/pharmacy/collections`);
  redirect(`/${locale}/pharmacy/collections/${res.data.id}`);
}

async function createManual(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const ph = String(formData.get("ph") ?? "");
  const title = String(formData.get("title_fa") ?? "").trim().slice(0, 120);
  if (!UUID_RE.test(ph) || !title) redirect(`/${locale}/pharmacy/collections?ph=${ph}&error=1`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("collections").insert({
    pharmacy_id: ph, slug: randomSlug(), title: { fa: title }, status: "published", featured: true,
  }).select("id").single();
  if (error || !data) redirect(`/${locale}/pharmacy/collections?ph=${ph}&error=1`);
  redirect(`/${locale}/pharmacy/collections/${data.id}`);
}

async function savePolicy(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const ph = String(formData.get("ph") ?? "");
  const v = String(formData.get("policy") ?? "");
  if (!UUID_RE.test(ph)) redirect(`/${locale}/pharmacy/collections`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("pharmacies")
    .update({ sort_policy: ["stock_discount", "stock_price", "stock_name"].includes(v) ? v : null })
    .eq("id", ph).select("id");
  revalidatePath(`/${locale}/pharmacy/collections`);
  redirect(`/${locale}/pharmacy/collections?ph=${ph}&${!error && (data?.length ?? 0) > 0 ? "saved=1" : "error=1"}`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getCollectionTexts(locale).phTitle, robots: { index: false } };
}

export default async function PharmacyCollections({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ph?: string; error?: string; saved?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  const c = getCollectionTexts(locale);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/pharmacy/collections`);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: mData } = await supabase.from("memberships")
    .select("pharmacy_id, pharmacies(id, slug, name_fa, name_i18n, sort_policy)")
    .eq("user_id", user.id).not("pharmacy_id", "is", null);
  const phs = ((mData as unknown as { pharmacies: Ph | null }[]) ?? []).map((m) => m.pharmacies).filter((p): p is Ph => !!p);
  const ph = phs.find((p) => p.id === sp.ph) ?? phs[0];
  if (!ph) redirect(`/${locale}/pharmacy/dashboard`);

  const [{ data: canData }, { data: ownData }, { data: dorvaData }, { data: sizesData }] = await Promise.all([
    supabase.rpc("can_manage_collections", { p_pharmacy: ph.id }),
    supabase.from("collections").select(COLLECTION_FIELDS).eq("pharmacy_id", ph.id).order("sort").order("created_at"),
    supabase.from("collections").select("id, slug, title").is("pharmacy_id", null).eq("status", "published").order("sort"),
    supabase.rpc("collection_sizes", { p_pharmacy: ph.id }),
  ]);
  const sizes = new Map(((sizesData as { collection_id: string; products: number }[]) ?? []).map((x) => [x.collection_id, x.products]));
  const canEdit = canData === true;
  const ownAll = (ownData as CollectionRow[]) ?? [];
  const own = ownAll.filter((r) => r.status !== "archived");
  const archivedRows = ownAll.filter((r) => r.status === "archived");
  const dorva = (dorvaData as { id: string; slug: string; title: I18n }[]) ?? [];
  const dorvaTitle = new Map(dorva.map((d) => [d.id, titleOf(d.title, locale)]));
  const copied = new Set(ownAll.map((o) => o.source_id).filter(Boolean));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/${locale}/pharmacy/dashboard?ph=${ph.id}`} className="text-sm text-brand-700 hover:underline">← {c.backDashboard}</Link>
          <h1 className="mt-1 text-2xl font-extrabold">{c.phTitle} — {localized(ph.name_fa, ph.name_i18n, locale)}</h1>
          <StaffAccessNote pharmacy={ph.id} locale={locale} />
        </div>
        <Link href={`/${locale}/${ph.slug}`} className="btn-ghost">{t.dashboard.viewPage}</Link>
      </div>
      <p className="max-w-3xl text-sm text-muted">{c.phIntro}</p>
      {phs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {phs.map((p) => (
            <Link key={p.id} href={`/${locale}/pharmacy/collections?ph=${p.id}`} className={p.id === ph.id ? "btn" : "btn-ghost"}>
              {localized(p.name_fa, p.name_i18n, locale)}</Link>
          ))}
        </div>
      )}
      {sp.error && <ErrorBox message={c.error} />}
      {sp.saved && <OkBox message={c.saved} />}
      {!canEdit && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.phNoAccess}</p>}

      {canEdit && (
        <div className="grid gap-4 md:grid-cols-2">
          <form action={copyCollection} className="card space-y-3 p-4">
            <h2 className="font-bold">{formatNumber(1, locale)}. {c.copyFrom}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="ph" value={ph.id} />
            <select name="source" required className="input py-2" aria-label={c.copyFrom}>
              {dorva.filter((d) => !copied.has(d.id)).map((d) => <option key={d.id} value={d.id}>{titleOf(d.title, locale)}</option>)}
            </select>
            <SubmitButton className="btn" pendingLabel="…">{c.copy}</SubmitButton>
          </form>
          <form action={createManual} className="card space-y-3 p-4">
            <h2 className="font-bold">{formatNumber(2, locale)}. {c.manualNew}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="ph" value={ph.id} />
            <input name="title_fa" required placeholder={c.titleFa} aria-label={c.titleFa} dir="rtl" className="input py-2" />
            <SubmitButton className="btn" pendingLabel="…">{c.create}</SubmitButton>
          </form>
        </div>
      )}

      <form action={savePolicy} className="card flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="ph" value={ph.id} />
        <div className="min-w-60 flex-1">
          <label className="label text-sm font-bold" htmlFor="policy">{c.phSortTitle}</label>
          <select id="policy" name="policy" defaultValue={ph.sort_policy ?? ""} disabled={!canEdit} className="input py-2">
            <option value="">{c.phSortDorva}</option>
            {Object.entries(c.phSortModes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{c.phSortHelp}</p>
        </div>
        {canEdit && <SubmitButton className="btn-ghost" pendingLabel="…">{c.save}</SubmitButton>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{c.title}</th>
              <th className="p-3 text-start">{c.status}</th>
              <th className="p-3 text-start">{c.featuredPharmacy}</th>
              <th className="p-3 text-start">{c.count}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {own.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="p-3">
                  <p className="font-semibold">{titleOf(r.title, locale)}</p>
                  <p className="text-xs text-muted">{r.source_id ? `${c.copyKind}: ${dorvaTitle.get(r.source_id) ?? ""}` : c.manualKind}</p>
                </td>
                <td className="p-3"><span className={`chip ${r.status === "published" ? "" : r.status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{c.statuses[r.status]}</span>
                  {r.status === "rejected" && r.review_note && <p className="mt-1 max-w-56 text-xs text-red-700">{r.review_note}</p>}</td>
                <td className="p-3">{r.featured ? "✓" : "—"}</td>
                <td className="p-3">{formatNumber(sizes.get(r.id) ?? 0, locale)}</td>
                <td className="p-3 text-end"><Link href={`/${locale}/pharmacy/collections/${r.id}`} className="text-brand-700 hover:underline">{c.edit}</Link></td>
              </tr>
            ))}
            {own.length === 0 && <tr><td colSpan={5} className="p-4 text-muted">{c.empty}</td></tr>}
          </tbody>
        </table>
      </div>

      {archivedRows.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer font-bold">{c.archived} ({formatNumber(archivedRows.length, locale)})</summary>
          <ul className="mt-3 divide-y divide-line text-sm">
            {archivedRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span>{titleOf(r.title, locale)}</span>
                <Link href={`/${locale}/pharmacy/collections/${r.id}`} className="text-brand-700 hover:underline">{c.restore}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
