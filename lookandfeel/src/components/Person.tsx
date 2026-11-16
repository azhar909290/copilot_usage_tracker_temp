import type { CSSProperties, ReactNode } from "react";

function initial(name: string) {
  const letter = name.match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? letter.toUpperCase() : "?";
}

/** A person shown as themselves: a stable initial on a pale tint of their own hue. */
export function Person({ name, hue, children }: { name: string; hue?: number; children?: ReactNode }) {
  return (
    <span className="person">
      <span
        className="avatar"
        data-unknown={hue === undefined || undefined}
        style={hue === undefined ? undefined : ({ "--hue": hue } as CSSProperties)}
        aria-hidden="true"
      >
        {hue === undefined ? "?" : initial(name)}
      </span>
      <span className="person-name" title={name}>
        {name}
      </span>
      {children}
    </span>
  );
}
