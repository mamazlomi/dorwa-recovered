import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { ErrorBox, OkBox, SetupNotice } from "@/components/SetupNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getCollectionTexts } from "@/i18n/dictionaries/collections";
import { getRules } from "@/i18n/dictionaries/rules";
import { revalidatePath } from "next/cache";
import { COLLECTION_FIELDS, SLUG_RE, titleOf, UUID_RE, type CollectionRow } from "@/lib/collections";
import { isConfigured } from "@/lib/config";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function createCollection(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const typed = String(formData.get("slug") ?? "").trim().toLowerCase();
  const slug = typed || `c-${Math.random().toString(36).slice(2, 8)}`;
  const title = String(formData.get("title_fa") ?? "").trim();
  if (!SLUG_RE.test(slug) || !title) redirect(`/${locale}/admin/collections?error=1`);
  const supabase = await createClient();
  // new collections go to the end of the order
  const { data: last } = await supabase.from("collections").select("sort").is("pharmacy_id", null)
    .order("sort", { ascending: false }).limit(1).maybeSingle();
  const sort = ((last as { sort: number } | null)?.sort ?? 0) + 10;
  const { data, error } = await supabase.from("collections")
    .insert({ slug, title: { fa: title }, status: "draft", sort }).select("id").single();
  if (error || !data) redirect(`/${locale}/admin/collections?error=1`);
  redirect(`/${locale}/admin/collections/${data.id}`);
}

async function moveCollection(formData: FormData) {
  "use server";
  const raw = String(formData.get("locale") ?? "fa");
  const locale = isLocale(raw) ? raw : "fa";
  const id = String(formData.get("id") ?? "");
  const dir = formData.get("dir") === "up" ? -1 : 1;
  if (UUID_RE.test(id)) {
    const supabase = await createClient();
    await supabase.rpc("move_collection", { p_id: id, p_dir: dir });
  }
  revalidatePath(`/${locale}/admin/collections`);
  redirect(`/${locale}/admin/collections`);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getCollectionTexts(locale).adminTitle, robots: { index: false } };
}

export default async function AdminCollections({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; deleted?: string; saved?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  const c = getCollectionTexts(locale);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/collections`);
  const supabase = await createClient();
  const { data: perms } = await supabase.rpc("my_platform_permissions");
  const permissions = (perms as string[] | null) ?? [];
  const canEdit = permissions.includes("collections.manage");
  if (!canEdit && !permissions.includes("pharmacy.read_all")) {
    return (
      <div className="card max-w-xl">
        <h1 className="mb-2 text-xl font-bold">{t.admin.noAccessTitle}</h1>
        <p className="text-sm text-muted">{c.noAccess}</p>
      </div>
    );
  }
  const sp = await searchParams;
  const [{ data }, { data: sizesData }] = await Promise.all([
    supabase.from("collections").select(COLLECTION_FIELDS).is("pharmacy_id", null).order("sort").order("slug"),
    supabase.rpc("collection_sizes"),
  ]);
  const all = (data as CollectionRow[]) ?? [];
  const rows = all.filter((r) => r.status !== "archived");
  const archived = all.filter((r) => r.status === "archived");
  const sizes = new Map(((sizesData as { collection_id: string; products: number }[]) ?? []).map((x) => [x.collection_id, x.products]));

  return (
    <div>
      <AdminTabs locale={locale} current="collections" labels={getRules(locale)} />
      <h1 className="mb-1 text-2xl font-extrabold">{c.adminTitle}</h1>
      <p className="mb-5 max-w-3xl text-sm text-muted">{c.adminIntro}</p>
      {sp.error && <div className="mb-4"><ErrorBox message={c.error} /></div>}
      {sp.deleted && <div className="mb-4"><OkBox message={c.deleted} /></div>}
      {sp.saved && <div className="mb-4"><OkBox message={c.saved} /></div>}
      {!canEdit && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.noAccess}</p>}

      {canEdit && (
        <form action={createCollection} className="card mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <h2 className="font-bold sm:col-span-3">{c.newCollection}</h2>
          <input type="hidden" name="locale" value={locale} />
          <div>
            <label className="label text-xs" htmlFor="new-title">{c.titleFa}</label>
            <input id="new-title" name="title_fa" required dir="rtl" className="input py-2" />
          </div>
          <div>
            <label className="label text-xs" htmlFor="new-slug">{c.slugOptional}</label>
            <input id="new-slug" name="slug" pattern="[a-z0-9][a-z0-9\-]{1,59}" dir="ltr" className="input py-2" />
          </div>
          <SubmitButton className="btn" pendingLabel="…">{c.create}</SubmitButton>
        </form>
      )}

      <p className="mb-2 text-xs text-muted">{c.orderHelp}</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-start text-xs text-muted">
            <tr>
              <th className="p-3 text-start">{c.title}</th>
              <th className="p-3 text-start">{c.status}</th>
              <th className="p-3 text-start">{c.featured}</th>
              <th className="p-3 text-start">{c.count}</th>
              <th className="p-3 text-start">{c.tabCol}</th>
              <th className="p-3 text-start">{c.rowOrder}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-line">
                <td className="p-3">
                  <p className="font-semibold">{titleOf(r.title, locale)}</p>
                  <code className="text-xs text-muted" dir="ltr">{r.slug}</code>
                </td>
                <td className="p-3">
                  <span className={`chip ${r.status === "published" ? "" : "bg-amber-100 text-amber-800"}`}>{c.statuses[r.status]}</span>
                </td>
                <td className="p-3">{r.featured ? "✓" : "—"}</td>
                <td className={`p-3 ${(sizes.get(r.id) ?? 0) < 4 ? "font-bold text-amber-800" : ""}`}>{formatNumber(sizes.get(r.id) ?? 0, locale)}</td>
                <td className="p-3">{r.show_as_tab ? (r.default_tab ? <span className="chip">{c.defaultMark}</span> : "✓") : "—"}</td>
                <td className="p-3">
                  {canEdit && (
                    <div className="flex gap-1">
                      {(["up", "down"] as const).map((d) => (
                        <form key={d} action={moveCollection}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="dir" value={d} />
                          <button disabled={d === "up" ? i === 0 : i === rows.length - 1}
                            title={d === "up" ? c.moveUp : c.moveDown} aria-label={d === "up" ? c.moveUp : c.moveDown}
                            className="btn-ghost px-2 py-1 text-sm disabled:opacity-30">{d === "up" ? "↑" : "↓"}</button>
                        </form>
                      ))}
                    </div>
                  )}
                </td>
                <td className="p-3 text-end">
                  <Link href={`/${locale}/admin/collections/${r.id}`} className="text-brand-700 hover:underline">{c.edit}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {archived.length > 0 && (
        <details className="card mt-5 p-4">
          <summary className="cursor-pointer font-bold">{c.archived} ({formatNumber(archived.length, locale)})</summary>
          <ul className="mt-3 divide-y divide-line text-sm">
            {archived.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span>{titleOf(r.title, locale)} <code className="text-xs text-muted" dir="ltr">{r.slug}</code></span>
                <Link href={`/${locale}/admin/collections/${r.id}`} className="text-brand-700 hover:underline">{c.restore}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
