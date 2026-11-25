// Placeholder product picture until real catalog images exist.
// Pure SVG, deterministic per product: the section picks the icon and hue
// family, the product id nudges the shade so neighbouring cards differ.

type Props = {
  id: string;
  name: string;
  section?: string | null;
  imageUrl?: string | null;
  className?: string;
  /** fill the parent box (the parent sets the aspect ratio) */
  fill?: boolean;
};

const SECTIONS: Record<string, { hue: number; icon: "capsule" | "drop" | "device" | "pill" | "book" }> = {
  "مکمل": { hue: 150, icon: "capsule" },
  "آرایشی و بهداشتی": { hue: 330, icon: "drop" },
  "تجهیزات و ملزومات": { hue: 205, icon: "device" },
  "داروهای بدون نسخه": { hue: 30, icon: "pill" },
  "اطلاعات دارویی": { hue: 265, icon: "book" },
  "دارو": { hue: 30, icon: "pill" },
};

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function Icon({ kind, color }: { kind: string; color: string }) {
  const common = { fill: "none", stroke: color, strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "drop":
      return <path {...common} d="M60 26 C60 26 40 50 40 63 a20 20 0 0 0 40 0 C80 50 60 26 60 26 Z M52 66 a8 8 0 0 0 8 8" />;
    case "device":
      return (
        <g {...common}>
          <rect x="38" y="30" width="44" height="54" rx="8" />
          <rect x="46" y="38" width="28" height="16" rx="3" />
          <circle cx="60" cy="70" r="6" />
        </g>
      );
    case "pill":
      return (
        <g {...common}>
          <circle cx="60" cy="57" r="22" />
          <path d="M44 57 h32" />
        </g>
      );
    case "book":
      return (
        <g {...common}>
          <path d="M36 34 h20 a6 6 0 0 1 6 6 v44 a5 5 0 0 0 -5 -5 h-21 Z" />
          <path d="M84 34 h-20 a6 6 0 0 0 -6 6 v44 a5 5 0 0 1 5 -5 h21 Z" />
        </g>
      );
    default:
      return (
        <g {...common} transform="rotate(-35 60 57)">
          <rect x="34" y="45" width="52" height="24" rx="12" />
          <path d="M60 45 v24" />
        </g>
      );
  }
}

export function ProductImage({ id, name, section, imageUrl, className = "", fill = false }: Props) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={name} loading="lazy" className={`${fill ? "h-full" : "aspect-square"} w-full rounded-xl object-cover ${className}`} />;
  }
  const s = SECTIONS[section ?? ""] ?? { hue: 175, icon: "capsule" };
  const h = hash(id);
  const hue = s.hue + ((h % 30) - 15);
  const bg1 = `hsl(${hue} 60% 94%)`;
  const bg2 = `hsl(${hue + 20} 55% 86%)`;
  const ink = `hsl(${hue} 45% 38%)`;
  const gid = `g${h.toString(36)}`;
  return (
    <svg viewBox="0 0 120 100" role="img" aria-label={name} preserveAspectRatio={fill ? "xMidYMid slice" : undefined}
      className={`w-full rounded-xl ${fill ? "h-full" : ""} ${className}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bg1} />
          <stop offset="1" stopColor={bg2} />
        </linearGradient>
      </defs>
      <rect width="120" height="100" fill={`url(#${gid})`} />
      <circle cx={20 + (h % 80)} cy={12 + (h % 20)} r="22" fill="#fff" opacity="0.35" />
      <Icon kind={s.icon} color={ink} />
    </svg>
  );
}
