import { titleOf } from "@/lib/collections";
import { asBlocks, type Block, type BlockType } from "@/lib/pageBlocks";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
export type Editor = {
  draft: Block[]; status: string; review_note: string | null; needs_approval: boolean;
  allowed: BlockType[]; max_blocks: number; max_slides: number; published_at: string | null;
};

/** Everything the page builder needs; null when the user may not edit this page. */
export async function loadBuilder(supabase: Client, pharmacy: string | null, locale: string) {
  const { data, error } = await supabase.rpc("page_editor", { p_pharmacy: pharmacy });
  if (error || !data) return null;
  const raw = data as Record<string, unknown>;
  // Dorva reviewers can read a draft (to preview it) but never edit a pharmacy's page
  if (raw.can_edit === false) return null;
  const draft = asBlocks(raw.draft);
  const ed: Editor = {
    draft, status: String(raw.status ?? "draft"), review_note: (raw.review_note as string | null) ?? null,
    needs_approval: raw.needs_approval === true, allowed: (raw.allowed as BlockType[]) ?? [],
    max_blocks: Number(raw.max_blocks ?? 15), max_slides: Number(raw.max_slides ?? 5),
    published_at: (raw.published_at as string | null) ?? null,
  };
  // collections this page may use: Dorva's, plus the pharmacy's own
  let q = supabase.from("collections").select("id, slug, title").eq("status", "published").order("sort");
  q = pharmacy ? q.or(`pharmacy_id.is.null,pharmacy_id.eq.${pharmacy}`) : q.is("pharmacy_id", null);
  const ids = new Set<string>();
  for (const b of draft) {
    if (b.type === "products" && b.source === "manual") (b.products ?? []).forEach((x) => ids.add(x));
    if (b.type === "tabs") b.tabs.forEach((t) => { if (t.source === "manual") (t.products ?? []).forEach((x) => ids.add(x)); });
    const links = b.type === "banner" ? b.slides.map((s) => s.link) : b.type === "categories" || b.type === "features" ? b.items.map((x) => x.link) : [];
    links.forEach((l) => { if (l?.kind === "product" && l.value) ids.add(l.value); });
  }
  const [{ data: cols }, { data: prods }] = await Promise.all([
    q,
    ids.size ? supabase.from("catalog_products").select("id, name_fa").in("id", [...ids]) : Promise.resolve({ data: [] }),
  ]);
  return {
    ed,
    collections: ((cols as { id: string; slug: string; title: Record<string, string> }[]) ?? [])
      .map((c) => ({ id: c.id, slug: c.slug, title: titleOf(c.title, locale as "fa") })),
    productNames: Object.fromEntries(((prods as { id: string; name_fa: string }[]) ?? []).map((p) => [p.id, p.name_fa])),
  };
}
