import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

/**
 * Generic click-a-column-header-to-sort behavior for any Process Performance
 * V2 table, matching Excel's A-Z/Z-A convention: first click sorts ascending,
 * second click on the same column flips to descending, a third click (or
 * clicking a different column) resets. `getValue` reads whatever field a
 * given column key maps to off a row; strings sort alphabetically (locale
 * compare), numbers numerically, and null/undefined always sort last
 * regardless of direction so blanks don't jump to the top on descending.
 */
export function useSortableRows<T>(rows: T[], getValue: (row: T, key: string) => string | number | null | undefined) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const withIndex = rows.map((row, i) => ({ row, i }));
    withIndex.sort((a, b) => {
      const av = getValue(a.row, sortKey);
      const bv = getValue(b.row, sortKey);
      const aBlank = av === null || av === undefined || av === "";
      const bBlank = bv === null || bv === undefined || bv === "";
      if (aBlank && bBlank) return a.i - b.i;
      if (aBlank) return 1;
      if (bBlank) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return cmp !== 0 ? cmp : a.i - b.i;
    });
    const ordered = withIndex.map((x) => x.row);
    return sortDir === "desc" ? ordered.reverse() : ordered;
  }, [rows, sortKey, sortDir, getValue]);

  function toggleSort(key: string) {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null);
    setSortDir("asc");
  }

  return { sorted, sortKey, sortDir, toggleSort };
}
