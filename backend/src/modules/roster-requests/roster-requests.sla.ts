import type { SlaState } from "./roster-requests.types.js";

const HOUR = 3_600_000;

export function computeSla(raisedAt: string, shiftDate: string, now: Date = new Date()): { state: SlaState; ageHours: number } {
  const raised = new Date(raisedAt).getTime();
  if (Number.isNaN(raised)) return { state: "ok", ageHours: 0 };
  const ageHours = Math.max(0, Math.floor((now.getTime() - raised) / HOUR));
  const shift = new Date(`${shiftDate.slice(0, 10)}T00:00:00Z`).getTime();
  const hoursToShift = Number.isNaN(shift) ? Infinity : (shift - now.getTime()) / HOUR;
  if (hoursToShift <= 24) return { state: "urgent", ageHours };
  if (ageHours > 48) return { state: "overdue", ageHours };
  if (ageHours >= 24) return { state: "due_soon", ageHours };
  return { state: "ok", ageHours };
}
