const RIDGES = [
  { base: 8.5, line: "M2 8.5H8L9.6 6L11.2 8.5L13 7.3L14.2 8.5H22", color: "var(--c-cost)" },
  { base: 13.5, line: "M2 13.5H7L9 9.6L11 13.5L12.6 11.1L14.6 13.5H22", color: "var(--c-tokens)" },
  { base: 19, line: "M2 19H6.4L9.4 11.6L12.2 19L14 15.3L16.2 19H22", color: "var(--c-calls)" },
];

/** The product mark: three telemetry ridges in the triad (cost, tokens, calls from back to front). */
export function RidgeMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {RIDGES.map((ridge) => (
        <g key={ridge.base}>
          <path d={`${ridge.line}V${ridge.base + 0.6}H2Z`} fill="var(--mark-ground, var(--ground))" />
          <path d={ridge.line} stroke={ridge.color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  );
}
