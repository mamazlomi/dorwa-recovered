// Edge shapes for section bands and the footer (filled with the current text
// color, or a right-to-left gradient matching "bg-gradient-to-l" bands).
const PATHS = {
  wave: "M0,48 C240,96 480,0 720,48 C960,96 1200,0 1440,48 L1440,96 L0,96 Z",
  curve: "M0,96 Q720,-24 1440,96 Z",
  zigzag: "M0,96 L0,56 " + Array.from({ length: 24 }, (_, i) => `L${i * 60 + 30},24 L${(i + 1) * 60},56`).join(" ") + " L1440,96 Z",
  tilt: "M0,96 L1440,8 L1440,96 Z",
  bump: "M0,96 L0,72 C560,72 600,8 720,8 C840,8 880,72 1440,72 L1440,96 Z",
} as const;
export type ShapeKind = keyof typeof PATHS;
export const SHAPE_KINDS = Object.keys(PATHS) as ShapeKind[];

export function Shape({ kind, flip = false, className = "", gradient }: {
  kind: ShapeKind; flip?: boolean; className?: string;
  /** [right color, left color] */ gradient?: [string, string];
}) {
  const id = `g-${kind}-${flip ? 1 : 0}`;
  return (
    <svg aria-hidden viewBox="0 0 1440 96" preserveAspectRatio="none" className={`${className} ${flip ? "-scale-y-100" : ""}`}>
      {gradient && (
        <defs>
          <linearGradient id={id} x1="1" x2="0" y1="0" y2="0">
            <stop offset="0" stopColor={gradient[0]} /><stop offset="1" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
      )}
      <path d={PATHS[kind]} fill={gradient ? `url(#${id})` : "currentColor"} />
    </svg>
  );
}
