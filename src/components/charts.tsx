// Small, dependency-free SVG/HTML charts for the dashboards (server-rendered).
// Palette (validated, light surface): teal = primary series, blue = second series.
// Hover: every mark carries a native tooltip (<title> / title attribute).

export const C = { teal: "#14907a", blue: "#2a78d6", orange: "#eb6834", grid: "#e6e8eb", ink2: "#5b6470" };
const RAMP = ["#eefaf7", "#d5f2ea", "#a8e2d3", "#6cc9b2", "#34ab93", "#14907a", "#0c5c4f"];

type Pt = { label: string; value: number; title: string };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// one series over time; x labels at the ends and the middle only
export function LineChart({ points, color = C.teal, fmt }: { points: Pt[]; color?: string; fmt: (n: number) => string }) {
  const W = 600, H = 190, L = 8, R = 8, T = 12, B = 26;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const n = points.length;
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const step = n > 1 ? (W - L - R) / (n - 1) : W;
  const ticks = [0, 0.5, 1];
  const labelAt = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : points.map((_, i) => i);
  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke={C.grid} strokeWidth="1" />
            <text x={L + 2} y={y(max * t) - 3} fontSize="10" fill={C.ink2}>{fmt(max * t)}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i} className="group">
            <rect x={x(i) - step / 2} y={T} width={step} height={H - T - B} fill="transparent">
              <title>{p.title}</title>
            </rect>
            <circle cx={x(i)} cy={y(p.value)} r="4" fill={color} stroke="#fff" strokeWidth="2"
              className="opacity-0 group-hover:opacity-100" pointerEvents="none" />
          </g>
        ))}
        {labelAt.map((i) => (
          <text key={i} x={x(i)} y={H - 8} fontSize="10" fill={C.ink2} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
            {points[i]?.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// vertical columns (counts per day)
export function Columns({ points, color = C.teal, fmt }: { points: Pt[]; color?: string; fmt: (n: number) => string }) {
  const W = 600, H = 170, L = 8, R = 8, T = 12, B = 26;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const n = Math.max(points.length, 1);
  const slot = (W - L - R) / n;
  const bw = Math.max(2, Math.min(18, slot - 2));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const labelAt = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : points.map((_, i) => i);
  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke={C.grid} strokeWidth="1" />
            <text x={L + 2} y={y(max * t) - 3} fontSize="10" fill={C.ink2}>{fmt(max * t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const h = (H - T - B) * (p.value / max);
          const cx = L + slot * i + slot / 2;
          return (
            <g key={i}>
              {p.value > 0 && <rect x={cx - bw / 2} y={y(p.value)} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={color} className="hover:opacity-80" />}
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent"><title>{p.title}</title></rect>
            </g>
          );
        })}
        {labelAt.map((i) => (
          <text key={i} x={L + slot * i + slot / 2} y={H - 8} fontSize="10" fill={C.ink2} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
            {points[i]?.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ranked horizontal bars; text stays in ink, the bar carries the value
export function BarList({ rows, color = C.teal }: { rows: { label: string; value: number; display: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r, i) => (
        <li key={i} title={`${r.label}: ${r.display}`}>
          <div className="mb-1 flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{r.display}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// day × hour grid, Saturday first
export function Heatmap({ cells, weekdays, less, more, unit }: {
  cells: [number, number, number][]; weekdays: string[]; less: string; more: string; unit: (n: number) => string;
}) {
  const order = [6, 0, 1, 2, 3, 4, 5];
  const map = new Map(cells.map(([d, h, n]) => [`${d}-${h}`, n]));
  const max = Math.max(1, ...cells.map((c) => c[2]));
  const shade = (n: number) => (n <= 0 ? "#f4f5f6" : RAMP[Math.min(RAMP.length - 1, Math.ceil((n / max) * RAMP.length) - 1)]);
  return (
    <div className="overflow-x-auto">
      <div dir="ltr" className="min-w-[560px]">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: "72px repeat(24, minmax(0, 1fr))" }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[10px] text-muted">{h % 3 === 0 ? h : ""}</div>
          ))}
          {order.map((d, ri) => (
            <div key={d} className="contents">
              <div className="truncate pe-1 text-end text-[11px] text-muted">{weekdays[ri]}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const n = map.get(`${d}-${h}`) ?? 0;
                return <div key={h} className="aspect-square rounded-[3px]" style={{ background: shade(n) }}
                  title={`${weekdays[ri]} ${String(h).padStart(2, "0")}:00 — ${unit(n)}`} />;
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted">
          <span>{less}</span>
          {RAMP.map((c) => <span key={c} className="inline-block h-3 w-3 rounded-[3px]" style={{ background: c }} />)}
          <span>{more}</span>
        </div>
      </div>
    </div>
  );
}

export function Stats({ items }: { items: { label: string; value: string; tone?: "warn" | "bad" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl bg-gray-50 p-3">
          <dt className="text-xs text-muted">{it.label}</dt>
          <dd className={`mt-1 text-lg font-bold tabular-nums ${it.tone === "bad" ? "text-red-700" : it.tone === "warn" ? "text-amber-700" : ""}`}>
            {it.tone && <span aria-hidden className="me-1">{it.tone === "bad" ? "▲" : "●"}</span>}
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}
