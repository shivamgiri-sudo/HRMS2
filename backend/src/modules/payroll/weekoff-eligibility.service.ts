import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";

// ─── Slab helper ──────────────────────────────────────────────────────────────

// The last slab previously ended at 25 (max 4 week-offs). Months with 5 Sundays have
// availableWorkingDays=26, so paidBase 24–25 was capped at 4 by the slab instead of
// falling through to the "full attendance → all week-offs" path at line 100. Adding a
// slab for 26–31 (max 5) covers 5-Sunday months correctly.
const DEFAULT_SLABS_JSON = '[{"from":0,"to":6,"max_weekoffs":0},{"from":7,"to":11,"max_weekoffs":1},{"from":12,"to":17,"max_weekoffs":2},{"from":18,"to":23,"max_weekoffs":3},{"from":24,"to":25,"max_weekoffs":4},{"from":26,"to":31,"max_weekoffs":5}]';
const DEFAULT_SLABS: Array<{ from: number; to: number; max_weekoffs: number }> = JSON.parse(DEFAULT_SLABS_JSON);

async function loadWeekoffSlabs(): Promise<Array<{ from: number; to: number; max_weekoffs: number }>> {
  const raw = await getPolicyValue("payroll", "weekoff_eligibility", "slabs", DEFAULT_SLABS_JSON);
  try { return JSON.parse(raw); } catch { return DEFAULT_SLABS; }
}

export async function getSlabMaxWeekoffs(paidBase: number): Promise<number> {
  const slabs = await loadWeekoffSlabs();
  return findSlabMaxWeekoffs(paidBase, slabs) ?? Infinity;
}

/**
 * Slab lookup used by getSlabMaxWeekoffs.
 *
 * Slab boundaries (from/to) are whole numbers, but paidBase is fractional the moment the
 * month has even one half-day or on-duty day (present + halfDay*0.5 + onDuty). The previous
 * version matched a slab with `paidBase >= slab.from && paidBase <= slab.to`, which is an
 * exact-integer-range test: a paidBase of exactly 23.5 satisfies neither the 18-23 slab (fails
 * <= 23) nor the 24-25 slab (fails >= 24), so no slab matched. Both callers treat "no slab
 * matched" as full/unlimited eligibility, so every fractional value sitting on a slab boundary
 * (6.5, 11.5, 17.5, 23.5) was silently granted MORE week-offs than the slab table intends,
 * not fewer -- the gap is a leak, not a cap.
 *
 * Fixed by treating the boundary between two adjacent slabs as continuous: a slab's effective
 * upper bound is the next slab's `from` (exclusive), not its own `to`. Only the final slab keeps
 * its own `to` as a real ceiling, since paidBase values above it are intentionally uncapped
 * (full eligibility) per the original slab table's design.
 */
export function findSlabMaxWeekoffs(
  paidBase: number,
  slabs: Array<{ from: number; to: number; max_weekoffs: number }>
): number | undefined {
  for (let i = 0; i < slabs.length; i++) {
    const slab = slabs[i];
    const isLast = i === slabs.length - 1;
    if (isLast) {
      if (paidBase >= slab.from && paidBase <= slab.to) return slab.max_weekoffs;
    } else if (paidBase >= slab.from && paidBase < slabs[i + 1].from) {
      return slab.max_weekoffs;
    }
  }
  return undefined;
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
 * If employee worked all available working days (calendar - weekoffs - holidays),
 * they earn all weekoffs. Otherwise apply the paid-base slab cap.
 *
 * `holidayCount` is the company holidays that fall in the month for THIS employee — the
 * eligible count from resolveHolidaysForEmployeeV2, which reads leave_holiday_master.
 * A holiday is not a day the employee could have worked, so counting it against them in the
 * "did you work everything available" test punishes people for a day the company closed.
 *
 * It was doing exactly that. paidBase scores present/late/half/leave but never holidays, so in
 * a month with H holidays the highest paid base anyone can reach is (daysInMonth - weekoffs - H).
 * Compared against an availableWorkingDays that ignored holidays, the full-attendance branch
 * became unreachable: August 2026 had 5 Sundays and 2 holidays, so a perfect attendance record
 * capped at 24 against a threshold of 26 and fell to the slab — 4 week-offs instead of 5. Six of
 * seventeen HEAD OFFICE employees lost a day that way, including one present every working day
 * of the month. November 2026 is worse: 30 days, 5 Sundays, and 2 holidays would put a perfect
 * record at 23 — into the wide 18-23 slab, losing 2 of 5.
 *
 * Subtracting holidays here rather than adding them to paidBase is deliberate. paidBase is
 * derived from attendance_daily_record, while the holiday credit payroll pays comes from
 * leave_holiday_master via resolveHolidaysForEmployeeV2. Folding holidays into paidBase would
 * make the entitlement depend on the engine having written 'holiday' rows — and on 2026-09-02
 * it had written none at all for August across the whole company, which would have stripped the
 * holiday from everyone rather than granting the week-off.
 */
export async function calculateWeekoffEligibility(
  employeeId: string,
  paidBase: number,
  runMonth: string,
  holidayCount: number
): Promise<number> {
  const actualCount = await resolveActualWeekoffCount(employeeId, runMonth);

  const [year, month] = runMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  // Validate, do not clamp. Clamping an absurd count DOWN to workingDays still drives
  // availableWorkingDays to zero, and `paidBase >= 0` is true for everyone — which would grant a
  // full week-off entitlement to an employee who worked three days. An unusable holiday count
  // therefore falls back to 0, reverting to the pre-existing behaviour: conservative, never free
  // pay. Only a count that is finite and strictly inside the month's working days is applied.
  const workingDays = daysInMonth - actualCount;
  const holidaysAreUsable =
    Number.isFinite(holidayCount) && holidayCount >= 0 && holidayCount < workingDays;
  const safeHolidays = holidaysAreUsable ? holidayCount : 0;

  // Calculate available working days (calendar days minus weekoffs minus company holidays)
  const availableWorkingDays = workingDays - safeHolidays;

  // If employee worked all available working days, they get all weekoffs
  if (paidBase >= availableWorkingDays) {
    return actualCount;
  }

  // Otherwise apply the paid-base slab cap
  const slabMax = await getSlabMaxWeekoffs(paidBase);
  if (slabMax === Infinity) return actualCount;
  return Math.min(slabMax, actualCount);
}
