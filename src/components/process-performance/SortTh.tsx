import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { SortDir } from "./useSortableRows";

/**
 * Drop-in replacement for a plain `<th>` that makes a column sortable
 * A-Z/Z-A (Excel-style) -- pass the same className the table already uses so
 * it keeps that table's own header styling, plus which column key this
 * header sorts by and the sort state from useSortableRows.
 */
export function SortTh({
  label, sortKey, activeKey, dir, onSort, className,
}: { label: React.ReactNode; sortKey: string; activeKey: string | null; dir: SortDir; onSort: (key: string) => void; className?: string }) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap ${className ?? ""}`}
      onClick={() => onSort(sortKey)}
      role="columnheader"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </th>
  );
}
