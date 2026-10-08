/**
 * View-models of cost per source. Every figure is an estimate (Meta spend is a last-30-day total spread over the range, messaging uses the
 * owner's rates), so the labels say so. Rupee amounts are Indian-grouped; a missing figure (no divisor, no data) is an en dash, never 0.
 * Pure: no DOM, no regex literals.
 */
import type { DriveAnalytics, SourceType } from "../driveCommandTypes";
import { COMPARE_COLUMNS, COST_CELLS, SOURCE_TYPES, TYPE_LABEL, costOf } from "../driveCommandModel";

const DASH = "–";
type Column = { key: string; label: string; kind: "count" | "rate" | "money" };

export function moneyText(n: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
}

export const COST_TITLE = "Cost per source (estimated)";
export interface CostTile { sourceType: SourceType; label: string; rows: Array<{ label: string; text: string }> }

/** One block per drive type, or null while cost is unavailable (the KPI strip then keeps its placeholder). */
export function costTiles(a: DriveAnalytics): CostTile[] | null {
  const by = costOf(a);
  if (!by) return null;
  return SOURCE_TYPES.map((t) => {
    const c = by[t];
    return {
      sourceType: t, label: TYPE_LABEL[t],
      rows: [
        { label: "Spend", text: moneyText(c ? c.total : null) }, { label: "Per lead", text: moneyText(c ? c.perLead : null) },
        { label: "Per arrival", text: moneyText(c ? c.perArrival : null) }, { label: "Per join", text: moneyText(c ? c.perJoin : null) },
      ],
    };
  });
}

/** The backend note, plus a plain warning when a cost read failed (the figures may then be too low). */
export function costNoteFor(a: DriveAnalytics): string {
  const base = typeof a?.cost?.note === "string" ? a.cost.note : "";
  const failed = (Array.isArray(a?.failedSections) ? a.failedSections : []).some((f) => typeof f === "string" && f.startsWith("cost"));
  return failed ? `${base} Some cost figures could not be read, so the totals may be too low.`.trim() : base;
}

const COST_LABEL: Record<string, string> = {
  cost_per_lead: "Cost per lead (est.)", cost_per_qualified: "Cost per qualified (est.)", cost_per_arrival: "Cost per arrival (est.)", cost_per_join: "Cost per join (est.)",
};
/** The Plan 4 columns, plus the four estimated money columns when cost is available. */
export function compareColumnsFor(a: DriveAnalytics): ReadonlyArray<Column> {
  if (!costOf(a)) return COMPARE_COLUMNS;
  return [...COMPARE_COLUMNS, ...COST_CELLS.map(([key]) => ({ key, label: COST_LABEL[key], kind: "money" as const }))];
}
