const WIDTH = 640;
const STEP = 6;

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type Ridge = { base: number; line: string; fill: string; opacity: number };

function buildRidges(count: number, top: number, gap: number): Ridge[] {
  const random = seeded(20261030);
  return Array.from({ length: count }, (_, index) => {
    const depth = index / Math.max(1, count - 1);
    const base = top + index * gap;
    const bumps = Array.from({ length: 3 + Math.floor(random() * 2) }, () => ({
      center: WIDTH * (0.3 + random() * 0.42),
      width: 10 + random() * 34,
      height: (0.35 + random() * 0.65) * (24 + 46 * Math.sin(Math.PI * (0.25 + depth * 0.6))),
    }));
    const points: string[] = [];
    for (let x = 0; x <= WIDTH; x += STEP) {
      const signal = bumps.reduce(
        (sum, bump) => sum + bump.height * Math.exp(-0.5 * ((x - bump.center) / bump.width) ** 2),
        0,
      );
      const grain = (random() - 0.5) * (0.8 + signal * 0.05);
      points.push(`${x} ${(base - signal - grain).toFixed(1)}`);
    }
    const line = `M${points.join("L")}`;
    return { base, line, fill: `${line}V${base + 1}H0Z`, opacity: 0.2 + depth * 0.7 };
  });
}

const RIDGES = buildRidges(18, 74, 10);

/** Decorative joyplot used while data loads. Each ridge breathes on a staggered loop (CSS). */
export function SignalLines({ className, compact = false }: { className?: string; compact?: boolean }) {
  const ridges = compact ? RIDGES.filter((_, index) => index % 2 === 1) : RIDGES;
  return (
    <svg
      className={`signal-lines${className ? ` ${className}` : ""}`}
      viewBox={`0 ${compact ? 40 : 0} ${WIDTH} ${compact ? 220 : 260}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {ridges.map((ridge, index) => (
        <g className="signal-ridge" key={ridge.base} style={{ ["--i" as string]: index }}>
          <path className="signal-fill" d={ridge.fill} />
          <path
            className={index === ridges.length - 1 ? "signal-stroke is-front" : "signal-stroke"}
            d={ridge.line}
            style={{ opacity: ridge.opacity }}
          />
        </g>
      ))}
    </svg>
  );
}
