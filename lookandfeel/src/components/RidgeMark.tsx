export function RidgeMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: "none",
        borderRadius: size / 4,
        background: "conic-gradient(from 200deg, #0ea5a4, #2563eb, #7c3aed, #db2777, #ea7a1a, #0ea5a4)",
      }}
    />
  );
}
