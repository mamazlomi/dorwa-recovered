import { formatNumber, localized, type Locale } from "@/i18n";
import { getProfileTexts } from "@/i18n/dictionaries/profile";
import { getTeamTexts } from "@/i18n/dictionaries/team";
import { getRound5Texts } from "@/i18n/dictionaries/round5";
import { mediaUrl } from "@/lib/pageBlocks";

type Shift = { days: number[]; from: string; to: string };
type About = {
  founder_name: string | null; about_fa: string | null; about_i18n: Record<string, string>;
  hours: { always?: boolean; shifts?: Shift[]; note?: string }; phone: string | null; address: string | null;
  lat: number; lng: number; services: string[];
  service_groups?: { code: string; name_fa: string; name_i18n: Record<string, string>; items: { code: string; name_fa: string; name_i18n: Record<string, string> }[] }[];
  kinds: { code: string; name_fa: string; name_i18n: Record<string, string> }[];
  officers: {
    full_name: string; council_no: string | null; photo: string | null; bio: string | null; shifts: Shift[];
    degree?: string | null; university?: string | null; specialty?: string | null; years?: string | null; languages?: string | null;
  }[];
};
type Member = { full_name: string; role_name: string; photo: string | null; expertise: string[]; bio: string | null; council_no: string | null; education: string | null };
type Named = { name_fa: string; name_i18n: Record<string, string> };

// Saturday = 0, in Tehran time
function nowInTehran() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(get("weekday"));
  return { day, time: `${get("hour")}:${get("minute")}` };
}
export function isOpen(h: About["hours"]): boolean | null {
  if (h?.always) return true;
  const shifts = h?.shifts ?? [];
  if (!shifts.length) return null;
  const { day, time } = nowInTehran();
  return shifts.some((s) => s.days.includes(day) && (s.from <= s.to ? time >= s.from && time < s.to : time >= s.from || time < s.to));
}

// The "About" tab of a pharmacy page.
export function PharmacyAbout({ about, team, insurers, locale }: { about: About; team: Member[]; insurers: Named[]; locale: Locale }) {
  const P = getProfileTexts(locale);
  const O = getRound5Texts(locale).officer;
  const groups = about.service_groups ?? [];
  const cred = (o: About["officers"][number]) => [
    o.degree ? O.degrees[o.degree] ?? o.degree : "", o.specialty ?? "", o.university ?? "",
    Number(o.years) > 0 ? O.publicYears.replace("{n}", formatNumber(Number(o.years), locale)) : "",
  ].filter(Boolean).join(" · ");
  const T = getTeamTexts(locale);
  const text = locale === "fa" ? about.about_fa : about.about_i18n?.[locale] || about.about_fa;
  const open = isOpen(about.hours);
  const shiftLine = (s: Shift) => `${s.days.map((d) => P.days[d]).join("، ")} · ${formatNumber(Number(s.from.slice(0, 2)), locale)}:${s.from.slice(3)}–${formatNumber(Number(s.to.slice(0, 2)), locale)}:${s.to.slice(3)}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-5">
        <section className="card space-y-3">
          <h2 className="text-lg font-bold">{P.tabAbout}</h2>
          {text ? <p className="whitespace-pre-line leading-8">{text}</p> : <p className="text-sm text-muted">{P.noAbout}</p>}
          {about.founder_name && <p className="text-sm"><span className="text-muted">{P.founderLabel}: </span>{about.founder_name}</p>}
          {about.kinds.length > 0 && (
            <div className="flex flex-wrap gap-2">{about.kinds.map((k) => <span key={k.code} className="chip bg-accent-50 text-accent-700">{localized(k.name_fa, k.name_i18n, locale)}</span>)}</div>
          )}
        </section>

        {about.officers.length > 0 && (
          <section className="card space-y-3">
            <h2 className="text-lg font-bold">{P.officersTitle}</h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {about.officers.map((o, i) => (
                <li key={i} className="flex gap-3">
                  {o.photo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={mediaUrl(o.photo)} alt={o.full_name} className="h-20 w-20 shrink-0 rounded-full border border-line object-cover" />
                    : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-brand-50 text-2xl text-brand-700">{o.full_name.slice(0, 1)}</span>}
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-bold">{o.full_name}</p>
                    {cred(o) && <p className="text-xs">{cred(o)}</p>}
                    {o.council_no && <p className="text-xs text-muted">{P.councilLabel}: <span dir="ltr">{o.council_no}</span></p>}
                    {o.languages && <p className="text-xs text-muted">{O.languages}: {o.languages}</p>}
                    {o.shifts?.length > 0 && <p className="text-xs text-muted">{o.shifts.map(shiftLine).join(" | ")}</p>}
                    {o.bio && <p className="leading-6">{o.bio}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {team.length > 0 && (
          <section className="card space-y-3">
            <h2 className="text-lg font-bold">{T.team}</h2>
            <ul className="grid gap-4 sm:grid-cols-3">
              {team.map((m, i) => (
                <li key={i} className="space-y-1 text-center text-sm">
                  {m.photo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={mediaUrl(m.photo)} alt={m.full_name} className="mx-auto h-20 w-20 rounded-full border border-line object-cover" />
                    : <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-brand-50 text-2xl text-brand-700">{m.full_name.slice(0, 1)}</span>}
                  <p className="font-bold">{m.full_name}</p>
                  <p className="text-xs text-muted">{m.role_name}</p>
                  {m.expertise.length > 0 && <p className="text-xs">{m.expertise.map((x) => T.expertiseOpts[x] ?? x).join("، ")}</p>}
                  {m.council_no && <p className="text-xs text-muted">{P.councilLabel}: <span dir="ltr">{m.council_no}</span></p>}
                  {m.bio && <p className="text-xs leading-5 text-muted">{m.bio}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="space-y-5">
        <section className="card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">{P.hoursTitle}</h2>
            {open != null && <span className={`chip ${open ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{open ? P.openNow : P.closedNow}</span>}
          </div>
          {about.hours?.always ? <p className="text-sm">{P.alwaysOpen}</p>
            : <ul className="space-y-1 text-sm">{(about.hours?.shifts ?? []).map((s, i) => <li key={i}>{shiftLine(s)}</li>)}</ul>}
          {about.hours?.note && <p className="text-xs text-muted">{about.hours.note}</p>}
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-bold">{P.contactTitle}</h2>
          {about.address && <p>{about.address}</p>}
          <div className="flex flex-wrap gap-2">
            {about.phone && <a href={`tel:${about.phone}`} className="btn text-sm" dir="ltr">{P.call} · {about.phone}</a>}
            <a href={`https://www.openstreetmap.org/?mlat=${about.lat}&mlon=${about.lng}#map=17/${about.lat}/${about.lng}`} target="_blank" rel="noreferrer" className="btn-ghost text-sm">{P.route} ↗</a>
          </div>
        </section>
        {insurers.length > 0 && (
          <section className="card space-y-2">
            <h2 className="font-bold">{P.insurersTitle}</h2>
            <div className="flex flex-wrap gap-2">{insurers.map((x, i) => <span key={i} className="chip">{localized(x.name_fa, x.name_i18n, locale)}</span>)}</div>
          </section>
        )}
        {(groups.length > 0 || about.services.length > 0) && (
          <section className="card space-y-3">
            <h2 className="font-bold">{P.servicesTitle}</h2>
            {groups.map((g) => (
              <div key={g.code}>
                <h3 className="mb-1 text-xs font-bold text-muted">{localized(g.name_fa, g.name_i18n, locale)}</h3>
                <div className="flex flex-wrap gap-1.5">{g.items.map((x) => <span key={x.code} className="chip text-xs">{localized(x.name_fa, x.name_i18n, locale)}</span>)}</div>
              </div>
            ))}
            {about.services.length > 0 && <ul className="list-inside list-disc text-sm">{about.services.map((x) => <li key={x}>{x}</li>)}</ul>}
          </section>
        )}
      </aside>
    </div>
  );
}
