"use client";

import Link from "next/link";

// Generic, reusable filter bar for any list (pharmacies, products, orders …).
// Works as a plain GET form: filters live in the URL, so results are shareable
// and indexable. Selects submit on change; a field can reset dependent fields.
export type FilterField =
  | { type: "text"; name: string; label: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[];
      emptyLabel?: string; resets?: string[] };

export function FilterBar({ action, fields, values, applyLabel, clearLabel, compact, clearHref }: {
  action: string;
  /** where "clear filters" goes; default: the bare list page */
  clearHref?: string;
  fields: FilterField[];
  values: Record<string, string | undefined>;
  applyLabel: string;
  clearLabel: string;
  // compact: a single inline field inside another card (no frame, no "clear")
  compact?: boolean;
}) {
  const active = fields.some((f) => values[f.name]);
  return (
    <form
      // remount when the URL's filters change, so fields never show stale values
      key={JSON.stringify(values)}
      action={action}
      method="get"
      // keep shared URLs clean: empty filters are not sent
      onSubmit={(e) => {
        const empty = Array.from(e.currentTarget.elements).filter(
          (el): el is HTMLInputElement | HTMLSelectElement =>
            (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && !!el.name && el.value === "",
        );
        empty.forEach((el) => (el.disabled = true));
        setTimeout(() => empty.forEach((el) => (el.disabled = false)), 0);
      }}
      className={compact
        ? "grid grid-cols-[1fr_auto] items-end gap-2"
        : "card grid gap-3 sm:grid-cols-[2fr_repeat(3,1fr)_auto] sm:items-end"}>
      {fields.map((f) =>
        f.type === "text" ? (
          <div key={f.name}>
            <label className="label" htmlFor={`f-${f.name}`}>{f.label}</label>
            <input id={`f-${f.name}`} name={f.name} defaultValue={values[f.name] ?? ""} placeholder={f.placeholder} className="input" type="search" />
          </div>
        ) : (
          <div key={f.name}>
            <label className="label" htmlFor={`f-${f.name}`}>{f.label}</label>
            <select
              id={`f-${f.name}`}
              name={f.name}
              defaultValue={values[f.name] ?? ""}
              className="input"
              onChange={(e) => {
                const form = e.currentTarget.form;
                f.resets?.forEach((dep) => {
                  const el = form?.elements.namedItem(dep);
                  if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) el.value = "";
                });
                // navigate directly (some mobile browsers ignore requestSubmit from a select)
                if (!form) return;
                const qs = new URLSearchParams();
                Array.from(form.elements).forEach((el) => {
                  if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.name && el.value) qs.set(el.name, el.value);
                });
                const q = qs.toString();
                window.location.assign(`${action}${q ? `?${q}` : ""}`);
              }}
            >
              {f.emptyLabel !== undefined && <option value="">{f.emptyLabel}</option>}
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ),
      )}
      <div className="flex gap-2">
        <button className="btn">{applyLabel}</button>
        {active && !compact && <Link href={clearHref ?? action} className="btn-ghost">{clearLabel}</Link>}
      </div>
    </form>
  );
}
