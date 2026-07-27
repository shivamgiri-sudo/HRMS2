import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";

// ─── Slab helper ──────────────────────────────────────────────────────────────

const DEFAULT_SLABS_JSON = '[{"from":0,"to":6,"max_weekoffs":0},{"from":7,"to":11,"max_weekoffs":1},{"from":12,"to":17,"max_weekoffs":2},{"from":18,"to":23,"max_weekoffs":3},{"from":24,"to":25,"max_weekoffs":4}]';
const DEFAULT_SLABS: Array<{ from: number; to: number; max_weekoffs: number }> = JSON.parse(DEFAULT_SLABS_JSON);

async function loadWeekoffSlabs(): Promise<Array<{ from: number; to: number; max_weekoffs: number }>> {
  const raw = await getPolicyValue("payroll", "weekoff_eligibility", "slabs", DEFAULT_SLABS_JSON);
  try { return JSON.parse(raw); } catch { return DEFAULT_SLABS; }
}

export async function getSlabMaxWeekoffs(paidBase: number): Promise<number> {
  const slabs = await loadWeekoffSlabs();
  for (const slab of slabs) {
    if (paidBase >= slab.from && paidBase <= slab.to) return slab.max_weekoffs;
  }
  return Infinity;
}

// ─── Last day of month ────────────────────────────────────────────────────────

function lastDayOfMonth(runMonth: string): number {
  const [year, month] = runMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

// ─── Actual week-off count resolver ──────────────────────────────────────────

/**
 * Returns the number of weekly-off days for an employee in the given run month.
 * Weekly-off count is always the number of Sundays in the calendar month,
 * regardless of shift pattern or roster. Roster determines WHICH day is the
 * weekly off; payroll eligibility count is always Sunday-based.
 */
export async function resolveActualWeekoffCount(
  _employeeId: string,
  runMonth: string
): Promise<number> {
  const [year, month] = runMonth.split("-").map(Number);
  const lastDay = lastDayOfMonth(runMonth);
  let sundays = 0;
  for (let day = 1; day <= lastDay; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  return sundays;
}

// ─── Main eligibility calculator ─────────────────────────────────────────────

/**
 * Returns the number of eligible week-offs for payroll computation.
 * If employee worked all available working days (calendar - actual weekoffs),
 * they earn all weekoffs. Otherwise apply the paid-base slab cap.
 */
export async function calculateWeekoffEligibility(
  employeeId: string,
  paidBase: number,
  runMonth: string
): Promise<number> {
  const actualCount = await resolveActualWeekoffCount(employeeId, runMonth);

  const [year, month] = runMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  // Calculate available working days (calendar days minus actual weekoffs)
  const availableWorkingDays = daysInMonth - actualCount;

  // If employee worked all available working days, they get all weekoffs
  if (paidBase >= availableWorkingDays) {
    return actualCount;
  }

  // Otherwise apply the paid-base slab cap
  const slabMax = await getSlabMaxWeekoffs(paidBase);
  if (slabMax === Infinity) return actualCount;
  return Math.min(slabMax, actualCount);
}
