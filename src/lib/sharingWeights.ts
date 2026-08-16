import type { MonthlyDriverInput } from "@/hooks/useBranchBudget";

/**
 * Shared with Branch Budget planning (BranchBudgetPlannerGrid) so a branch total splits across
 * cost centres the same way whether it's being planned or being raised against as a GRN. Extracted
 * rather than duplicated, so a change to one sharing method's math can't silently diverge from the
 * other caller.
 */

/** The weight each method divides by, read from the same drivers the server uses. */
export function weightFor(method: string, driver: Partial<MonthlyDriverInput> | undefined): number {
  if (!driver) return 0;
  switch (method) {
    case "total_manpower":
    case "agent_headcount":
      return Number(driver.plannedHeadcount) || 0;
    case "revenue_share":
      return (Number(driver.plannedHeadcount) || 0) * (Number(driver.revenueRatePerHead) || 0);
    case "grade_weighted_headcount":
      return Number(driver.plannedHeadcount) || 0;
    case "seat_count":
      return Number(driver.seatCount) || 0;
    case "floor_area":
      return Number(driver.floorAreaSqft) || 0;
    case "device_count":
      return Number(driver.deviceCount) || 0;
    case "hiring_volume":
      return Number(driver.hiringVolume) || 0;
    default:
      return 1; // equal_split
  }
}

/** Largest remainder at whole-rupee granularity, so the visible split always adds up exactly. */
export function splitRupees(total: number, weights: number[]): number[] {
  const rupees = Math.round(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !rupees) return weights.map(() => 0);
  const raw = weights.map((w) => (rupees * w) / sum);
  const floors = raw.map((v) => Math.floor(v));
  const remainder = rupees - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floors[order[k % order.length].i] += 1;
  return floors;
}
