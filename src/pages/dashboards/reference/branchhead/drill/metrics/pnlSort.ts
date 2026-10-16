import type { ProcessPnlRow } from "../../../../../../../backend/src/modules/branch-head-health/types";

export type PnlSortKey = "revenue" | "people" | "other" | "op" | "opPct" | "status";
export type SortDir = "asc" | "desc";

const STATUS_RANK: Record<ProcessPnlRow["status"], number> = { "loss-making": 0, "at-risk": 1, profitable: 2 };

function value(r: ProcessPnlRow, key: PnlSortKey): number | null {
  const v = key === "revenue" ? r.revenue : key === "people" ? r.peopleCost : key === "other" ? r.otherCost
    : key === "op" ? r.operatingProfit : key === "opPct" ? r.opPct : STATUS_RANK[r.status];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A sorted copy: missing values last in either direction, ties by process name (A to Z). */
export function sortPnlRows(rows: readonly ProcessPnlRow[], key: PnlSortKey, dir: SortDir): ProcessPnlRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, key);
    const vb = value(b, key);
    if (va == null || vb == null) {
      if (va !== vb) return va == null ? 1 : -1;
    } else if (va !== vb) return (va - vb) * sign;
    return String(a.processName ?? "").localeCompare(String(b.processName ?? ""));
  });
}

export function ariaSort(column: PnlSortKey, active: PnlSortKey, dir: SortDir): "ascending" | "descending" | "none" {
  if (column !== active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}
