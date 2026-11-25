"use client";

import { useState } from "react";

export type Perm = { code: string; grp: string; description_fa: string; can_grant: boolean };
type Template = { id: string; name_fa: string; permissions: string[]; can_grant: boolean };

// Ticks for one person's access: pick a template to fill them, then adjust.
// Sends role_id and every ticked "perm" with the surrounding form.
export function AccessEditor({ perms, templates, roleId, current, labels, groupNames, permNames }: {
  perms: Perm[]; templates: Template[]; roleId: string; current: string[];
  labels: { template: string; templateHint: string; all: string; none: string; cannotGrant: string };
  groupNames: Record<string, string>; permNames: Record<string, string>;
}) {
  const [role, setRole] = useState(roleId);
  const [on, setOn] = useState<Set<string>>(new Set(current));
  const grantable = new Set(perms.filter((p) => p.can_grant).map((p) => p.code));
  const groups = [...new Set(perms.map((p) => p.grp))];
  const pick = (id: string) => {
    setRole(id);
    const t = templates.find((x) => x.id === id);
    if (t) setOn(new Set(t.permissions));
  };
  const flip = (code: string, v: boolean) => setOn((s) => { const n = new Set(s); if (v) n.add(code); else n.delete(code); return n; });
  const setGroup = (g: string, v: boolean) => setOn((s) => {
    const n = new Set(s);
    perms.filter((p) => p.grp === g && grantable.has(p.code)).forEach((p) => (v ? n.add(p.code) : n.delete(p.code)));
    return n;
  });

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">{labels.template}</span>
        <select name="role_id" value={role} onChange={(e) => pick(e.target.value)} className="input py-1.5 text-sm">
          {templates.filter((t) => t.can_grant || t.id === roleId).map((t) => <option key={t.id} value={t.id}>{t.name_fa}</option>)}
        </select>
        <span className="text-xs text-muted">{labels.templateHint}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g} className="rounded-xl border border-line p-3">
            <legend className="flex w-full items-center justify-between gap-2 px-1 text-sm font-bold">
              <span>{groupNames[g] ?? g}</span>
              <span className="flex gap-2 text-xs font-normal">
                <button type="button" className="text-brand-700 hover:underline" onClick={() => setGroup(g, true)}>{labels.all}</button>
                <button type="button" className="text-muted hover:underline" onClick={() => setGroup(g, false)}>{labels.none}</button>
              </span>
            </legend>
            <ul className="space-y-1.5">
              {perms.filter((p) => p.grp === g).map((p) => (
                <li key={p.code}>
                  <label className={`flex items-start gap-2 text-sm ${p.can_grant ? "cursor-pointer" : "opacity-50"}`} title={p.can_grant ? undefined : labels.cannotGrant}>
                    <input type="checkbox" name="perm" value={p.code} checked={on.has(p.code)} disabled={!p.can_grant}
                      onChange={(e) => flip(p.code, e.target.checked)} className="mt-1 h-4 w-4 accent-brand-600" />
                    <span>{permNames[p.code] ?? p.description_fa}</span>
                  </label>
                  {/* a ticked permission the editor cannot change is kept as it is */}
                  {!p.can_grant && on.has(p.code) && <input type="hidden" name="perm" value={p.code} />}
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
