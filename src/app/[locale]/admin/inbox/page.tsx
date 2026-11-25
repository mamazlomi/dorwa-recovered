import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminTabs } from "@/components/AdminTabs";
import { SetupNotice } from "@/components/SetupNotice";
import { formatNumber, isLocale, resolveLocale } from "@/i18n";
import { getRound6Texts } from "@/i18n/dictionaries/round6";
import { getRules } from "@/i18n/dictionaries/rules";
import { isUuid } from "@/lib/cart";
import { isConfigured } from "@/lib/config";
import { mediaUrl } from "@/lib/pageBlocks";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type J = Record<string, unknown>;
type Officer = J & { id?: string; full_name?: string; photo?: string | null };
type ProfileChange = { pharmacy: { id: string; slug: string; name_fa: string }; submitted_at: string; payload: J; live: J };
type OfficerChange = { user_id: string; submitted_at: string; payload: J; live: J | null; pharmacies: string[] | null };
type CollectionChange = {
  id: string; slug: string; title: Record<string, string>; description: Record<string, string>;
  pharmacy: { id: string; slug: string; name_fa: string }; submitted_at: string; rules: number; include: number;
};

const LINKS: Record<string, string> = {
  pharmacies: "/admin/pharmacies", pages: "/admin/pages", looks: "/admin/theme", prices: "/admin/prices", codes: "/admin/codes",
  profiles: "#profiles", officers: "#officers", collections: "#collections",
};

// ---------------------------------------------------------------- decisions (one action per decision)
const ctx = (formData: FormData) => {
  const raw = String(formData.get("locale") ?? "fa");
  return { locale: isLocale(raw) ? raw : "fa", id: String(formData.get("id") ?? ""), note: String(formData.get("note") ?? "").trim() };
};
const finish = (locale: string, r: string) => {
  revalidatePath(`/${locale}/admin/inbox`);
  redirect(`/${locale}/admin/inbox?r=${encodeURIComponent(r)}`);
};
const rpcResult = (res: { data: unknown; error: { code?: string } | null }) =>
  res.error ? (res.error.code === "42501" ? "forbidden" : "unknown") : String(res.data);

async function decide(kind: "profile" | "officer" | "collection", approve: boolean, formData: FormData) {
  const { locale, id, note } = ctx(formData);
  if (!isUuid(id)) return finish(locale, "unknown");
  if (!approve && note.length < 5) return finish(locale, "note");
  const supabase = await createClient();
  const res = kind === "profile"
    ? await supabase.rpc("profile_change_review", { p_pharmacy: id, p_approve: approve, p_note: note || null })
    : kind === "officer"
      ? await supabase.rpc("officer_change_review", { p_user: id, p_approve: approve, p_note: note || null })
      : await supabase.rpc("collection_review", { p_id: id, p_approve: approve, p_note: note || null });
  if (approve) revalidatePath("/[locale]/[slug]", "page");
  finish(locale, rpcResult(res));
}
async function approveProfile(fd: FormData) { "use server"; await decide("profile", true, fd); }
async function rejectProfile(fd: FormData) { "use server"; await decide("profile", false, fd); }
async function approveOfficer(fd: FormData) { "use server"; await decide("officer", true, fd); }
async function rejectOfficer(fd: FormData) { "use server"; await decide("officer", false, fd); }
async function approveCollection(fd: FormData) { "use server"; await decide("collection", true, fd); }
async function rejectCollection(fd: FormData) { "use server"; await decide("collection", false, fd); }

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await resolveLocale(params);
  return { title: getRound6Texts(locale).inbox.title, robots: { index: false } };
}

export default async function ApprovalInbox({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }>;
}) {
  const { locale, t } = await resolveLocale(params);
  if (!isConfigured) return <SetupNotice title={t.common.setupTitle} body={t.common.setupBody} />;
  const { user } = await getUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/admin/inbox`);
  const T = getRound6Texts(locale).inbox;
  const F = T.fields;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: countsData } = await supabase.rpc("approval_inbox");
  const counts = (countsData as Record<string, number> | null) ?? {};
  const has = (k: string) => k in counts;

  const [profilesRes, officersRes, collectionsRes, srv, kinds, ins] = await Promise.all([
    has("profiles") ? supabase.rpc("profile_change_queue") : Promise.resolve({ data: [] }),
    has("officers") ? supabase.rpc("officer_change_queue") : Promise.resolve({ data: [] }),
    has("collections") ? supabase.rpc("collection_queue") : Promise.resolve({ data: [] }),
    supabase.from("pharmacy_service_options").select("code, name_fa"),
    supabase.from("pharmacy_kinds").select("code, name_fa"),
    supabase.from("insurers").select("code, name_fa"),
  ]);
  const names = new Map<string, string>([
    ...((srv.data as { code: string; name_fa: string }[] | null) ?? []).map((x) => [`s:${x.code}`, x.name_fa] as [string, string]),
    ...((kinds.data as { code: string; name_fa: string }[] | null) ?? []).map((x) => [`k:${x.code}`, x.name_fa] as [string, string]),
    ...((ins.data as { code: string; name_fa: string }[] | null) ?? []).map((x) => [`i:${x.code}`, x.name_fa] as [string, string]),
  ]);
  const profiles = (profilesRes.data as ProfileChange[] | null) ?? [];
  const officers = (officersRes.data as OfficerChange[] | null) ?? [];
  const collections = (collectionsRes.data as CollectionChange[] | null) ?? [];
  const total = Object.values(counts).reduce((a, n) => a + Number(n || 0), 0);
  const when = (s: string) => new Date(s).toLocaleString(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  // ---------------------------------------------------------------- what changed, field by field
  const str = (v: unknown): string => {
    if (v == null || v === "") return "—";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  };
  const list = (prefix: string, v: unknown) => (Array.isArray(v) ? (v as string[]).map((c) => names.get(`${prefix}:${c}`) ?? c).join("، ") : "—");
  const hours = (h: unknown) => {
    const x = (h ?? {}) as { always?: boolean; shifts?: { days: number[]; from: string; to: string }[]; note?: string };
    if (x.always) return "۲۴ ساعته";
    return [(x.shifts ?? []).map((s) => `${s.days.join(",")}: ${s.from}–${s.to}`).join(" | "), x.note].filter(Boolean).join(" — ") || "—";
  };
  type Row = { label: string; before: string; after: string; img?: [string | null, string | null] };
  const textRows = (before: J, after: J, keys: [string, string, (v: unknown) => string][]): Row[] =>
    keys.map(([k, label, f]) => ({ label, before: f(before[k]), after: f(after[k]) })).filter((r) => r.before !== r.after);
  const officerRows = (b: Officer, a: Officer): Row[] => {
    const rows = textRows(b, a, [
      ["full_name", F.full_name, str], ["council_no", F.council_no, str], ["bio", F.bio, str], ["invite_email", F.invite_email, str],
      ["shifts", F.shifts, str], ["resume", F.resume, (v) => (v ? "✓" : "—")],
    ]);
    const pb = { ...((b.profile as J) ?? {}) }; const pa = { ...((a.profile as J) ?? {}) };
    delete pb.resume_text; delete pa.resume_text;
    for (const k of new Set([...Object.keys(pb), ...Object.keys(pa)])) {
      if (str(pb[k]) !== str(pa[k])) rows.push({ label: `${F.profile}: ${k}`, before: str(pb[k]), after: str(pa[k]) });
    }
    if ((b.photo ?? null) !== (a.photo ?? null)) rows.push({ label: T.photo, before: "", after: "", img: [b.photo ?? null, a.photo ?? null] });
    return rows;
  };
  const profileRows = (live: J, p: J): Row[] => {
    const li = (live.about_i18n ?? {}) as J; const pi = (p.about_i18n ?? {}) as J;
    const rows = textRows(live, p, [
      ["phone", F.phone, str], ["address", F.address, str], ["founder_name", F.founder_name, str], ["about_fa", F.about_fa, str],
      ["hours", F.hours, hours], ["kind_codes", F.kind_codes, (v) => list("k", v)], ["service_codes", F.service_codes, (v) => list("s", v)],
      ["services", F.services, (v) => (Array.isArray(v) ? v.join("، ") : "—")], ["insurers", F.insurers, (v) => list("i", [...((v as string[]) ?? [])].sort())],
    ]);
    if (str(li.en) !== str(pi.en)) rows.push({ label: F.about_en, before: str(li.en), after: str(pi.en) });
    if (str(li.ar) !== str(pi.ar)) rows.push({ label: F.about_ar, before: str(li.ar), after: str(pi.ar) });
    if (`${live.lat},${live.lng}` !== `${p.lat},${p.lng}`) rows.push({ label: F.location, before: `${live.lat}, ${live.lng}`, after: `${p.lat}, ${p.lng}` });
    const lo = ((live.officers as Officer[]) ?? []); const po = ((p.officers as Officer[]) ?? []);
    for (const o of po) {
      const old = lo.find((x) => x.id && x.id === o.id);
      if (!old) { rows.push({ label: `${T.newOfficer}: ${o.full_name ?? ""}`, before: "—", after: [o.full_name, o.council_no, o.bio].map(str).join(" · "), img: o.photo ? [null, o.photo] : undefined }); continue; }
      for (const r of officerRows(old, o)) rows.push({ ...r, label: `${o.full_name ?? ""} — ${r.label}` });
    }
    for (const o of lo) if (!po.some((x) => x.id === o.id)) rows.push({ label: T.removedOfficer, before: str(o.full_name), after: "—" });
    return rows;
  };
  const Diff = ({ rows }: { rows: Row[] }) => rows.length === 0 ? <p className="text-xs text-muted">{T.noDiff}</p> : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted"><tr className="border-b border-line"><th className="py-1 text-start">{T.changes}</th><th className="text-start">{T.before}</th><th className="text-start">{T.after}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top last:border-0">
              <td className="py-2 pe-3 text-xs font-bold">{r.label}</td>
              {r.img ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <td className="py-2 pe-3">{r.img[0] ? <img src={mediaUrl(r.img[0])} alt="" className="h-20 w-20 rounded-lg object-cover" /> : "—"}</td>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <td className="py-2">{r.img[1] ? <img src={mediaUrl(r.img[1])} alt="" className="h-20 w-20 rounded-lg border-2 border-brand-500 object-cover" /> : "—"}</td>
                </>
              ) : (
                <>
                  <td className="whitespace-pre-line py-2 pe-3 text-muted line-through decoration-red-300">{r.before}</td>
                  <td className="whitespace-pre-line py-2 text-brand-800">{r.after}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const Decide = ({ id, approve, reject }: { id: string; approve: (fd: FormData) => Promise<void>; reject: (fd: FormData) => Promise<void> }) => (
    <div className="grid gap-2 md:grid-cols-[auto_1fr]">
      <form action={approve}>
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={id} />
        <button type="submit" className="btn">{T.approve}</button>
      </form>
      <form action={reject} className="flex flex-wrap gap-2">
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={id} />
        <input name="note" required minLength={5} maxLength={1000} placeholder={T.reasonPh} className="input min-w-0 flex-1" />
        <button type="submit" className="btn-ghost border-red-300 text-red-700">{T.reject}</button>
      </form>
    </div>
  );

  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} current="inbox" labels={getRules(locale)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{T.title}</h1>
        <Link href={`/${locale}/admin/settings#moderation.profile`} className="btn-ghost text-sm">{T.policy}</Link>
      </div>
      <p className="max-w-3xl text-sm text-muted">{T.intro}</p>
      {sp.r && <p role="status" className={`rounded-xl p-3 text-sm ${sp.r === "ok" ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>{T.results[sp.r] ?? sp.r}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(counts).map(([k, n]) => (
          <Link key={k} href={LINKS[k]?.startsWith("#") ? LINKS[k] : `/${locale}${LINKS[k] ?? ""}`}
            className={`card flex items-center justify-between gap-2 ${Number(n) > 0 ? "border-red-300" : ""}`}>
            <span className="text-sm">{T.kinds[k] ?? k}</span>
            <span className={`rounded-full px-2.5 text-sm font-bold leading-7 ${Number(n) > 0 ? "bg-red-600 text-white" : "bg-slate-100 text-slate-500"}`}>{formatNumber(Number(n), locale)}</span>
          </Link>
        ))}
      </section>
      {total === 0 && <p className="card text-sm text-muted">{T.empty}</p>}

      {profiles.length > 0 && (
        <section id="profiles" className="space-y-3">
          <h2 className="text-lg font-bold">{T.kinds.profiles} ({formatNumber(profiles.length, locale)})</h2>
          {profiles.map((c) => (
            <div key={c.pharmacy.id} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{c.pharmacy.name_fa}</p>
                <span className="text-xs text-muted">{T.submitted} {when(c.submitted_at)} · <Link href={`/${locale}/${c.pharmacy.slug}?tab=about`} className="text-brand-700 hover:underline">{T.open} ↗</Link></span>
              </div>
              <Diff rows={profileRows(c.live, c.payload)} />
              <Decide id={c.pharmacy.id} approve={approveProfile} reject={rejectProfile} />
            </div>
          ))}
        </section>
      )}

      {officers.length > 0 && (
        <section id="officers" className="space-y-3">
          <h2 className="text-lg font-bold">{T.kinds.officers} ({formatNumber(officers.length, locale)})</h2>
          {officers.map((c) => (
            <div key={c.user_id} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{str(c.payload.full_name)}</p>
                <span className="text-xs text-muted">{(c.pharmacies ?? []).join("، ")} · {T.submitted} {when(c.submitted_at)}</span>
              </div>
              <Diff rows={officerRows((c.live ?? {}) as Officer, c.payload as Officer)} />
              <Decide id={c.user_id} approve={approveOfficer} reject={rejectOfficer} />
            </div>
          ))}
        </section>
      )}

      {collections.length > 0 && (
        <section id="collections" className="space-y-3">
          <h2 className="text-lg font-bold">{T.kinds.collections} ({formatNumber(collections.length, locale)})</h2>
          {collections.map((c) => (
            <div key={c.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{c.title?.fa ?? c.slug} <span className="text-xs font-normal text-muted">— {c.pharmacy.name_fa}</span></p>
                <span className="text-xs text-muted">{T.submitted} {when(c.submitted_at)}</span>
              </div>
              {c.description?.fa && <p className="text-sm">{c.description.fa}</p>}
              {(c.title?.en || c.title?.ar) && <p className="text-xs text-muted">{[c.title.en, c.title.ar].filter(Boolean).join(" · ")}</p>}
              <p className="text-xs text-muted" dir="auto">/{c.slug} · {T.rulesInfo.replace("{r}", formatNumber(c.rules, locale)).replace("{i}", formatNumber(c.include, locale))}</p>
              <Decide id={c.id} approve={approveCollection} reject={rejectCollection} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
