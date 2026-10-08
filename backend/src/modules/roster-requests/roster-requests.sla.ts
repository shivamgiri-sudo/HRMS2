import type { SlaState } from "./roster-requests.types.js";

const HOUR = 3_600_000;

const IST_NAIVE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a DB/API timestamp to epoch ms (NaN when unparseable). Naive strings
 * ("YYYY-MM-DD HH:MM:SS", date-only) are IST (+05:30), matching the DB pool;
 * strings carrying Z/an offset parse as-is. Kept in sync with the frontend copy.
 */
export function parseDbTimestamp(value: string): number {
  const v = String(value ?? "").trim();
  if (DATE_ONLY.test(v)) return new Date(`${v}T00:00:00+05:30`).getTime();
  if (IST_NAIVE.test(v)) return new Date(`${v.replace(" ", "T")}+05:30`).getTime();
  return new Date(v).getTime();
}

export function computeSla(raisedAt: string, shiftDate: string, now: Date = new Date()): { state: SlaState; ageHours: number } {
  const raised = parseDbTimestamp(raisedAt);
  if (Number.isNaN(raised)) return { state: "ok", ageHours: 0 };
  const ageHours = Math.max(0, Math.floor((now.getTime() - raised) / HOUR));
  const shift = new Date(`${shiftDate.slice(0, 10)}T00:00:00+05:30`).getTime();
  const hoursToShift = Number.isNaN(shift) ? Infinity : (shift - now.getTime()) / HOUR;
  if (hoursToShift <= 24) return { state: "urgent", ageHours };
  if (ageHours > 48) return { state: "overdue", ageHours };
  if (ageHours >= 24) return { state: "due_soon", ageHours };
  return { state: "ok", ageHours };
}
