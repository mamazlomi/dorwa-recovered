"use client";

import { useState, useTransition, type ReactNode } from "react";
import { resetLayout, saveLayout, type WidgetPos } from "@/lib/dashboardActions";

type Texts = {
  edit: string; done: string; save: string; saved: string; reset: string; hidden: string;
  show: string; hide: string; up: string; down: string; size: Record<string, string>; dragHint: string;
};

const SPAN: Record<WidgetPos["size"], string> = { s: "lg:col-span-2", m: "lg:col-span-3", l: "lg:col-span-6" };

// Widget board: drag to reorder (desktop), up/down (touch), size S/M/L, hide/show.
// The layout is saved per user and per dashboard.
export function DashboardGrid({ scope, layout, widgets, texts }: {
  scope: string;
  layout: WidgetPos[];
  widgets: Record<string, { title: string; node: ReactNode }>;
  texts: Texts;
}) {
  const [items, setItems] = useState<WidgetPos[]>(layout);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const change = (fn: (xs: WidgetPos[]) => WidgetPos[]) => { setItems(fn); setMsg(""); };
  const move = (id: string, to: string) => change((xs) => {
    if (id === to) return xs;
    const from = xs.findIndex((x) => x.id === id);
    const cur = xs[from];
    const rest = xs.filter((x) => x.id !== id);
    const at = rest.findIndex((x) => x.id === to);
    rest.splice(from < xs.findIndex((x) => x.id === to) ? at + 1 : at, 0, cur);
    return rest;
  });
  const step = (id: string, d: -1 | 1) => change((xs) => {
    const vis = xs.filter((x) => !x.hidden);
    const i = vis.findIndex((x) => x.id === id);
    const j = i + d;
    if (j < 0 || j >= vis.length) return xs;
    const a = xs.findIndex((x) => x.id === id), b = xs.findIndex((x) => x.id === vis[j].id);
    const next = [...xs];
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  });
  const patch = (id: string, p: Partial<WidgetPos>) => change((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const visible = items.filter((x) => !x.hidden && widgets[x.id]);
  const hidden = items.filter((x) => x.hidden && widgets[x.id]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className={editing ? "btn" : "btn-ghost"} onClick={() => setEditing((e) => !e)}>
          {editing ? texts.done : texts.edit}
        </button>
        {editing && (
          <>
            <button type="button" className="btn-ghost" disabled={pending}
              onClick={() => start(async () => setMsg((await saveLayout(scope, items)) ? texts.saved : "!"))}>
              {texts.save}
            </button>
            <button type="button" className="btn-ghost" disabled={pending}
              onClick={() => start(async () => { if (await resetLayout(scope)) window.location.reload(); })}>
              {texts.reset}
            </button>
          </>
        )}
        {msg && <span className="text-sm text-brand-700" role="status">{msg}</span>}
      </div>
      {editing && <p className="mb-3 text-xs text-muted">{texts.dragHint}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        {visible.map((it, idx) => {
          const w = widgets[it.id];
          return (
            <section
              key={it.id}
              className={`card min-w-0 ${SPAN[it.size]} ${editing ? "cursor-move outline-dashed outline-1 outline-brand-500" : ""} ${over === it.id && drag !== it.id ? "ring-2 ring-brand-500" : ""} ${drag === it.id ? "opacity-50" : ""}`}
              draggable={editing}
              onDragStart={(e) => { setDrag(it.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", it.id); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              onDragOver={(e) => { if (editing && drag) { e.preventDefault(); setOver(it.id); } }}
              onDragLeave={() => setOver((o) => (o === it.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (drag) move(drag, it.id); setDrag(null); setOver(null); }}
            >
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold">{editing && <span aria-hidden className="me-1 text-muted">⠿</span>}{w.title}</h2>
                {editing && (
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <button type="button" className="btn-ghost px-2 py-1" disabled={idx === 0} onClick={() => step(it.id, -1)}>{texts.up}</button>
                    <button type="button" className="btn-ghost px-2 py-1" disabled={idx === visible.length - 1} onClick={() => step(it.id, 1)}>{texts.down}</button>
                    {(["s", "m", "l"] as const).map((s) => (
                      <button key={s} type="button" aria-pressed={it.size === s}
                        className={`rounded-md px-2 py-1 ${it.size === s ? "bg-brand-700 text-white" : "hover:bg-brand-50"}`}
                        onClick={() => patch(it.id, { size: s })}>{texts.size[s]}</button>
                    ))}
                    <button type="button" className="btn-ghost px-2 py-1" onClick={() => patch(it.id, { hidden: true })}>{texts.hide}</button>
                  </div>
                )}
              </header>
              <div className={editing ? "pointer-events-none select-none" : ""}>{w.node}</div>
            </section>
          );
        })}
      </div>

      {editing && hidden.length > 0 && (
        <div className="card mt-4">
          <h2 className="mb-2 font-bold">{texts.hidden}</h2>
          <div className="flex flex-wrap gap-2">
            {hidden.map((it) => (
              <button key={it.id} type="button" className="btn-ghost text-sm" onClick={() => patch(it.id, { hidden: false })}>
                + {widgets[it.id].title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
