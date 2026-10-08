import type { InsightKpi, InsightTable, RoleInsights } from "../../kit";

/** Pure helpers behind the Operations layout. */

export const kpiOf = (ins: RoleInsights | undefined, key: string): InsightKpi | undefined => ins?.kpis.find((k) => k.key === key);
export const tableOf = (ins: RoleInsights | undefined, key: string): InsightTable | undefined => ins?.tables.find((t) => t.key === key);

export type Rag = "green" | "amber" | "red" | "slate";

/** RAG for a process card from the numbers the card shows; unknown inputs never count as green. */
export function processRag(row: { fill?: number | null; att?: number | null; shr?: number | null }): Rag {
  const signals: Rag[] = [];
  if (typeof row.att === "number") signals.push(row.att >= 90 ? "green" : row.att >= 80 ? "amber" : "red");
  if (typeof row.shr === "number") signals.push(row.shr <= 15 ? "green" : row.shr <= 25 ? "amber" : "red");
  if (typeof row.fill === "number") signals.push(row.fill >= 95 ? "green" : row.fill >= 85 ? "amber" : "red");
  if (!signals.length) return "slate";
  return signals.includes("red") ? "red" : signals.includes("amber") ? "amber" : "green";
}

/** Width of a 0-100 bar; values are clamped so an over-staffed 160% fill cannot overflow its track. */
export const barWidth = (v: number | null | undefined, max = 100): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

export interface FteRow { name: string; actual: number; required: number; href?: string }

/** Scale for the FTE bars: the biggest of actual/required across rows, so bars are comparable between processes. */
export function fteScale(rows: FteRow[]): number {
  return Math.max(1, ...rows.flatMap((r) => [r.actual, r.required]));
}
