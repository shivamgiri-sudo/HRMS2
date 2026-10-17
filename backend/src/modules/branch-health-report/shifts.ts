/**
 * Shift-band helpers shared by the emailed Branch Health Report and the Branch Head page, so both
 * classify a shift and count "not on roster" late arrivals identically.
 */
export const BANDS = ["Morning", "Afternoon", "Evening", "Night"] as const;
export type ShiftBand = (typeof BANDS)[number];

export const BAND_HINT: Record<ShiftBand, string> = {
  Morning: "starts before 12:00",
  Afternoon: "12:00–16:59",
  Evening: "17:00–20:59",
  Night: "21:00 onward",
};

/** Band of a shift by its start hour (shift strings look like "09:00-18:00"). */
export function bandOf(shift: string): ShiftBand {
  const hour = Number.parseInt(shift.slice(0, 2), 10);
  if (!Number.isFinite(hour)) return "Morning";
  return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : hour < 21 ? "Evening" : "Night";
}

/**
 * Late-marked people of one process who have no planned shift today (no roster row, week-off worked,
 * on leave): the process's late total minus the late counted inside its slots.
 */
export function lateNotOnRoster(slots: Array<{ late: number }>, processLate: number): number {
  return Math.max(0, processLate - slots.reduce((n, x) => n + x.late, 0));
}
