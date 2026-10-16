import type { KpiId } from "./kpiModel";

export type { KpiId };

/** Section-level drill targets (in addition to the KPI tiles). */
export type MetricDrillId = KpiId | "attendance" | "headcount" | "attrition" | "finance" | "pnl" | "hiring" | "backlog" | "ops";

/** What a chart mark, tile or row asks the drill-down host (Task 4) to open. */
export type DrillTarget =
  | { kind: "process"; id: string; name: string }
  | { kind: "metric"; id: MetricDrillId };

const SPACE_CHARS = new Set([" ", "\t", "\n", "\r", "\f", "\v", " "]);

/** Trim, case-fold and collapse inner runs of whitespace to one space (no regex: Tailwind scans source). */
export function normalizeProcessName(name: string): string {
  let out = "";
  let pendingSpace = false;
  for (const ch of String(name ?? "")) {
    if (SPACE_CHARS.has(ch)) { pendingSpace = out.length > 0; continue; }
    if (pendingSpace) { out += " "; pendingSpace = false; }
    out += ch;
  }
  return out.toLowerCase();
}

/** The process whose name matches `name` after normalisation; null for a blank name or no match. */
export function joinByProcessName<T extends { processName: string }>(name: string, rows: readonly T[]): T | null {
  const key = normalizeProcessName(name);
  if (!key) return null;
  return rows.find((r) => normalizeProcessName(r.processName) === key) ?? null;
}

/** A process target when the name joins to a known process, else the section's metric target. */
export function processTarget<T extends { processId: string; processName: string }>(name: string, rows: readonly T[], fallback: MetricDrillId): DrillTarget {
  const hit = joinByProcessName(name, rows);
  return hit ? { kind: "process", id: hit.processId, name: hit.processName } : { kind: "metric", id: fallback };
}
