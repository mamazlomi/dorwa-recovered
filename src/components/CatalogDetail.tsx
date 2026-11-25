import { formatNumber } from "@/i18n";
import type { Locale } from "@/i18n/config";
import type { getCatalogSyncTexts } from "@/i18n/dictionaries/catalogSync";

// Catalog-layer detail of a product, exactly as the pharma-catalog API delivers it.
// The API omits anything it has no value for; here every heading, label and row is
// rendered only when its value exists, so a missing field shows nothing at all.

type Term = { fa?: string; en?: string };
type Component = {
  ingredient?: Term; role?: Term; amount?: number; unit?: Term; elemental_amount?: number; compound_amount?: number;
  chemical_form?: Term; standardization?: string; strain?: Term; daily_value_percent?: number; primary?: boolean;
};
export type CatalogData = {
  texts?: Record<string, string>;
  components?: Component[];
  manufacturer?: Term; license_holder?: Term; country?: Term; dosage_form?: Term;
  target?: { age?: Term; gender?: Term; physiological_status?: Term };
  serving?: { quantity?: number; unit?: string; raw?: string; servings_per_container?: number };
  codes?: Record<string, string[]>;
  presentations?: { irc?: string; gtin?: string }[];
};
type Texts = ReturnType<typeof getCatalogSyncTexts>;

const SECTIONS = ["long_description", "indications", "directions", "warnings", "precautions", "contraindications",
  "interactions", "side_effects", "recommendations", "storage"] as const;

const term = (t: Term | undefined, locale: Locale) => (t ? (locale === "fa" ? t.fa ?? t.en : t.en ?? t.fa) : undefined) || undefined;

/** extra specification rows for the product page; facet rows already shown are skipped */
export function catalogRows(d: CatalogData | null, T: Texts, locale: Locale, shown: string[]): [string, string][] {
  if (!d) return [];
  const rows: [string, string | undefined][] = [
    ...(["manufacturer", "license_holder", "country", "dosage_form"] as const)
      .filter((k) => !shown.includes(k))
      .map((k) => [T.labels[k], term(d[k], locale)] as [string, string | undefined]),
    [T.labels.age, term(d.target?.age, locale)],
    [T.labels.gender, term(d.target?.gender, locale)],
    [T.labels.serving, [
      d.serving?.raw || (d.serving?.quantity != null ? `${formatNumber(d.serving.quantity, locale)} ${d.serving.unit ?? ""}`.trim() : ""),
      d.serving?.servings_per_container != null ? T.servings(formatNumber(d.serving.servings_per_container, locale)) : "",
    ].filter(Boolean).join(" — ") || undefined],
  ];
  // codes from the codes object, falling back to the package presentations (IRC/GTIN often live there)
  const pick = (k: "irc" | "gtin") => [...new Set([...(d.codes?.[k] ?? []), ...(d.presentations ?? []).map((x) => x[k]).filter((v): v is string => !!v)])];
  const codes = ([["IRC", pick("irc")], ["GTIN", pick("gtin")], ["eRx", d.codes?.erx ?? []], [T.healthLicense, (d.codes?.health_license ?? []).filter((v) => !pick("irc").includes(v))]] as [string, string[]][])
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k}: ${v.join("، ")}`);
  if (codes.length) rows.push([T.codes, codes.join(" · ")]);
  return rows.filter((r): r is [string, string] => !!r[1]).map(([k, v]) => [k, v]);
}

export function CatalogDetail({ data, texts: T, locale }: { data: CatalogData | null; texts: Texts; locale: Locale }) {
  if (!data) return null;
  const comps = (data.components ?? []).filter((c) => term(c.ingredient, locale));
  const sections = locale === "fa" ? SECTIONS.filter((k) => data.texts?.[k]?.trim()) : [];
  if (!comps.length && !sections.length) return null;
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="space-y-6">
      {comps.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-bold">{T.components}</h2>
          {data.serving?.raw && <p className="text-xs text-muted">{T.perServing(data.serving.raw)}</p>}
          <table className="w-full text-sm">
            <tbody>
              {comps.map((c, i) => {
                const extra = [term(c.chemical_form, locale), c.standardization, term(c.strain, locale)].filter(Boolean).join(" — ");
                const amount = c.amount != null ? `${n(c.amount)} ${term(c.unit, locale) ?? ""}`.trim() : "";
                return (
                  <tr key={i} className="border-t border-line first:border-t-0">
                    <th scope="row" className="py-2 pe-3 text-start font-medium">
                      {term(c.ingredient, locale)}
                      {extra && <span className="block text-xs font-normal text-muted" dir="auto">{extra}</span>}
                    </th>
                    <td className="py-2 pe-3 whitespace-nowrap">{amount}</td>
                    <td className="py-2 text-xs text-muted">
                      {c.elemental_amount != null && T.elemental(`${n(c.elemental_amount)} ${term(c.unit, locale) ?? ""}`.trim())}
                      {c.daily_value_percent != null && <span className="ms-2">{n(c.daily_value_percent)}٪ DV</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {sections.map((k) => (
        <section key={k} className="card space-y-2">
          <h2 className="font-bold">{T.sections[k]}</h2>
          <p className="whitespace-pre-line text-sm leading-7">{data.texts![k]}</p>
        </section>
      ))}
    </div>
  );
}
