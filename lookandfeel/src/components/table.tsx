"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { formatPercent } from "@/lib/format";

export type SortDirection = "asc" | "desc";
export type Sort<K extends string> = { key: K; direction: SortDirection };

export function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

export function useSort<K extends string>(initial: Sort<K>, textKeys: K[]) {
  const [sort, setSort] = useState(initial);
  const toggle = (key: K) =>
    setSort((current) => ({
      key,
      direction:
        current.key === key ? (current.direction === "asc" ? "desc" : "asc") : textKeys.includes(key) ? "asc" : "desc",
    }));
  return [sort, toggle] as const;
}

export function sortBy<T, K extends string>(items: T[], sort: Sort<K>, read: (item: T, key: K) => unknown) {
  return [...items].sort((a, b) => {
    const result = compareValues(read(a, sort.key), read(b, sort.key));
    return sort.direction === "asc" ? result : -result;
  });
}

export function SortHeader<K extends string>({
  sortKey,
  label,
  sort,
  onSort,
  numeric = false,
}: {
  sortKey: K;
  label: string;
  sort: Sort<K>;
  onSort: (key: K) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={numeric ? "num" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className="sort-button" data-active={active || undefined} type="button" onClick={() => onSort(sortKey)}>
        <span className="sort-label">{label}</span>
        {active && <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function ShareBar({ share, from, to }: { share: number; from?: string; to?: string }) {
  return (
    <span className="share-cell">
      <span className="share-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, share)}%`, "--track-a": from, "--track-b": to } as CSSProperties} />
      </span>
      <span className="num">{formatPercent(share)}</span>
    </span>
  );
}
