# Employee Rejoin v3 — Stint-Aware Payroll (Plan 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay a rejoined employee for the days they were actually employed. The gap between the old last working day and the rejoin date must earn nothing, including the week-off and holiday credits that payroll hands out by calendar. Behind a feature flag that is **OFF by default**, so shipping this changes nothing until the owner turns it on.

**Architecture:** A small pure module turns an employee's `employment_stint` rows into "employed ranges" inside a run month (employed days, Sundays, is-this-date-employed). The payroll calculator uses it, only when the flag is on and only for employees who have stint rows (rejoiners), in three places: the active-days cap, the week-off credit and the holiday credit. Everyone else follows the exact current code path.

**Tech Stack:** TypeScript, mysql2, vitest. Builds on Plans 1-3b (branch `feat/rejoin-v3-flags`, worktree `/home/shuvam/hrms-rejoin-3`).

**Rules for every task:** TDD (test first, see it fail, implement, see it pass), commit per task, never push, never touch prod or a real database. Work in `/home/shuvam/hrms-rejoin-3` only; backend commands from `backend/`. **Run only the test files named in each step**; the full suite (~7 min) runs once, in the background, in Task 5. Known failing files that are NOT ours (fail on origin/main): `src/db/__tests__/shivamgiri-schema-case.test.ts`, `tests/upload-batch-retention.test.ts`, `src/workers/__tests__/esignDeadKitRedispatch.worker.test.ts`.

---

## What the research established (traced against the code)

- Nothing in payroll reads `employment_stint` today.
- `payrollCalculate.service.ts` (~2.7k lines, no direct unit test; it is covered by source-text contract tests):
  - Run selection `~:872`: `empConds.push(employmentWindowPredicate())` with `empParams.push(run.run_month, run.run_month)`. A rejoined employee (status Active, `date_of_exit` NULL, old exit `rejoined`) is selected for every month, including a month that lies wholly inside the gap.
  - Attendance `~:1244-1281`: `paid_base` sums `present`=1, `late`=1, `half_day`=0.5, `leave_approved`=1, else 0. **A calendar day with no attendance row adds 0 and is not LOP** (`lwpDeduction` is hard-coded 0). So gap working days are not paid.
  - **The leak:** `calculatedPayable = effectivePaidBase + finalWeekoffs + finalHolidays` where week-offs come from `calculateWeekoffEligibility(employeeId, paidBase, runMonth, eligibleHolidayCount)` (`weekoff-eligibility.service.ts`: `resolveActualWeekoffCount` = **all Sundays in the calendar month**, `workingDays = daysInMonth - actualCount`, `availableWorkingDays = workingDays - holidays`, slabs when `paidBase + holidays < availableWorkingDays`) and holidays from `resolveHolidaysForEmployeeV2(employeeId, runMonth)` (`holiday-work.service.ts`: `leave_holiday_master` rows in the month, minus those before the joining date or after `payableThrough(...)`). A Sunday or a holiday inside the gap is therefore paid.
  - Cap `~:1480`: `activeCals` = days from `max(salary_start_date, monthStart)` to `payableThrough(employment_end_date, monthEnd)`, floored with `Math.max(1, Math.min(days, daysInMonth))`; `finalPayableDays = Math.min(payableDaysOverride ?? calculatedPayable, activeCals)`. A rejoiner has NULL end date, so `activeCals` is the full month and a payroll-head payable-days override could pay the gap.
  - Skip rule `~:1318-1326`: employees whose start is after the month end are skipped with `continue`.
  - Month math is plain strings: `run.run_month` `'YYYY-MM'`, `daysInMonth = new Date(year, month, 0).getDate()`, `monthStart`/`monthEnd` `'YYYY-MM-DD'`.
- After a rejoin, the old exit is `rejoined`, so recalculating a month that contained the first stint's last day **loses the last-working-day cap** (full month is paid). Stint-awareness fixes this too.
- Traced numbers, September 2026 (30 days, Sundays 6/13/20/27), employed Sep 1-10 and Sep 20-30, all attended days `present` (18 paid-base days), no holidays: today's code pays 21 days (3 week-offs by slab) which is right but by luck; with a holiday on Sep 15 (in the gap) it pays 22. Stint-aware must give 21 in both cases.
- Feature flags: table `payroll_config_flags (branch_id, process_id, config_key, config_value VARCHAR(500), ...)` unique on `(branch_id, process_id, config_key)`; values are strings `'true'/'false'`; no central reader, each flag has its own. Default-OFF pattern: `salary-start-date.reconciliation.ts` (`salary_start_date_gate_enforced`, seeded false by migration 1883). Global row = `branch_id IS NULL AND process_id IS NULL`. Seed with `INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description) VALUES (UUID(), NULL, NULL, '<key>', 'false', '...')`. Admins toggle it on the existing Config Flags screen (`PUT /config-flags` in `payroll-more.routes.ts`) once seeded.
- Tests to model on: `payroll/__tests__/weekoff-holiday-aware.test.ts` and `weekoff-eligibility-slabs.test.ts` (pure calls with `vi.mock` of the policy cache's `getPolicyValue` returning the fallback); `payroll/__tests__/leaver-resolver-wiring.contract.test.ts` (reads the calculator source and asserts on it); `payroll/__tests__/employment-end-date.test.ts` (pure string tests).
- Not changed on purpose: F&F tenure (gratuity counts `date_of_joining` to LWD, i.e. continuous service, consistent with the 30-day continuity rule); `payroll-governance`/`payroll-readiness` population SQL (a rejoined Active employee passes); `running-salary` estimate.

## Decisions

- **Flag:** `payroll_config_flags` key `rejoin_stint_payroll_enabled`, global row, seeded `'false'`. Read once per run. Any read error means OFF.
- **Who is affected:** only employees that have rows in `employment_stint` (every rejoiner has them: stint 1 is written together with stint 2). Everyone else, and everyone when the flag is off, follows the unchanged code path. This must be provable by a contract test.
- **A month wholly inside the gap** (no stint overlaps it): the employee is skipped for that run, like the existing "starts after month end" skip. They get no line, so no stray week-off/holiday credit and no `Math.max(1, ...)` one-day floor.
- **`salary_start_date`** still applies: stint days before it are ignored (a payroll start later than the joining date keeps working for rejoiners).
- **Out of scope:** F&F, gratuity, the preview of what a flag flip would change for a given month (a follow-up report), and turning the flag on (the owner does that on the Config Flags screen after reviewing a recalculated month against db_bill).

## File Structure

| File | Responsibility |
|---|---|
| Create `backend/sql/migrations/2081_rejoin_stint_payroll_flag.sql` | seed the flag OFF |
| Modify `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json` | register |
| Create `backend/src/modules/payroll/stint-window.ts` | pure: `stintEmploymentSummary`, `isDateEmployed`, `dayNumber`, `isSunday` |
| Modify `backend/src/modules/payroll/weekoff-eligibility.service.ts` | optional `employment` argument |
| Modify `backend/src/modules/payroll/holiday-work.service.ts` | optional `employedRanges` argument to `resolveHolidaysForEmployeeV2` |
| Create `backend/src/modules/payroll/stint-payroll.service.ts` | flag reader + batch stint loader returning a per-employee scope |
| Modify `backend/src/modules/payroll/payrollCalculate.service.ts` | use the scope in the three places, behind the flag |
| Tests | `payroll/__tests__/stint-window.test.ts`, `weekoff-stint.test.ts`, `holiday-stint.test.ts`, `stint-payroll.service.test.ts`, `stint-payroll-wiring.contract.test.ts` |

---

### Task 1: Flag migration

**Files:** Create `backend/sql/migrations/2081_rejoin_stint_payroll_flag.sql`; modify `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json`.

- [ ] **Step 1: Write the migration**

```sql
-- Rejoin v3 plan 3c: stint-aware payroll. Seeds the feature flag OFF. Re-runnable: INSERT IGNORE on the
-- (branch_id, process_id, config_key) unique key. Turning it on is an owner decision on the Config Flags screen.
INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES (UUID(), NULL, NULL, 'rejoin_stint_payroll_enabled', 'false',
  'When true, payroll pays a rejoined employee only for the days inside their employment stints: the gap between the old last working day and the rejoin date earns no working days, no week-off credit and no holiday credit. Default false = unchanged behaviour.');
```

Note: `branch_id`/`process_id` are NULL in the unique key, and MySQL treats NULLs as distinct in a unique index, so `INSERT IGNORE` alone does not prevent a second row on re-run. Guard it: wrap in `INSERT INTO ... SELECT ... FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM payroll_config_flags WHERE branch_id IS NULL AND process_id IS NULL AND config_key = 'rejoin_stint_payroll_enabled')` instead of `INSERT IGNORE`, using the same column list and values.

- [ ] **Step 2: Register and lock**

Append to `MIGRATION_MANIFEST` after the `2080_...` entry:

```ts
  "migrations/2081_rejoin_stint_payroll_flag.sql", // Registered 2026-10-04. Seeds payroll_config_flags 'rejoin_stint_payroll_enabled' = 'false' (global row, NOT EXISTS-guarded because NULL branch/process defeat the unique key). Stint-aware payroll for rejoiners stays OFF until the owner enables it.
```

Run `cd backend && node scripts/update-migration-lock.mjs --write` and report the lock diff.

- [ ] **Step 3: Verify** `cd backend && npx vitest run tests/migration-hot-table-guard.test.ts src/db/__tests__/schema-column-refs.test.ts` (these two only) and `npx tsc --noEmit`. Expected: pass (`payroll_config_flags` is not a hot table and is already in the schema snapshot; if `schema-column-refs` objects to the raw INSERT, register what it asks).

- [ ] **Step 4: Commit** `feat(rejoin): seed the stint-aware payroll flag, off by default` (with the Co-Authored-By line).

---

### Task 2: Pure stint window module

**Files:** Create `backend/src/modules/payroll/stint-window.ts`; test `backend/src/modules/payroll/__tests__/stint-window.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { dayNumber, isSunday, stintEmploymentSummary, isDateEmployed, type Stint } from "../stint-window.js";

const SEP = { monthStart: "2026-09-01", monthEnd: "2026-09-30" };
const rejoiner: Stint[] = [
  { startDate: "2024-01-15", endDate: "2026-09-10" },
  { startDate: "2026-09-20", endDate: null },
];

describe("dayNumber / isSunday", () => {
  it("counts days from the epoch without timezone drift", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("2026-09-02") - dayNumber("2026-09-01")).toBe(1);
  });
  it("finds Sundays (2026-09-06 and 2026-09-13 are Sundays, 2026-09-07 is not)", () => {
    expect(isSunday("2026-09-06")).toBe(true);
    expect(isSunday("2026-09-13")).toBe(true);
    expect(isSunday("2026-09-07")).toBe(false);
    expect(isSunday("1970-01-04")).toBe(true);
  });
});

describe("stintEmploymentSummary", () => {
  it("September 2026: employed Sep 1-10 and Sep 20-30 = 21 days, 3 Sundays (6, 20, 27)", () => {
    const s = stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd);
    expect(s.ranges).toEqual([{ from: "2026-09-01", to: "2026-09-10" }, { from: "2026-09-20", to: "2026-09-30" }]);
    expect(s.employedDays).toBe(21);
    expect(s.sundays).toBe(3);
  });

  it("a month after the rejoin is the whole month", () => {
    const s = stintEmploymentSummary(rejoiner, "2026-10-01", "2026-10-31");
    expect(s.employedDays).toBe(31);
    expect(s.sundays).toBe(4);
  });

  it("the old stint's final month alone, caps at the old last working day", () => {
    const s = stintEmploymentSummary([rejoiner[0]!], SEP.monthStart, SEP.monthEnd);
    expect(s.employedDays).toBe(10);
  });

  it("a month wholly inside the gap has no employed days", () => {
    const s = stintEmploymentSummary(
      [{ startDate: "2026-01-01", endDate: "2026-06-30" }, { startDate: "2026-10-15", endDate: null }],
      "2026-08-01", "2026-08-31");
    expect(s.employedDays).toBe(0);
    expect(s.ranges).toEqual([]);
    expect(s.sundays).toBe(0);
  });

  it("clamps a stint that started before the month and ends inside it", () => {
    const s = stintEmploymentSummary([{ startDate: "2020-01-01", endDate: "2026-09-05" }], SEP.monthStart, SEP.monthEnd);
    expect(s.ranges).toEqual([{ from: "2026-09-01", to: "2026-09-05" }]);
  });

  it("merges overlapping or touching stints so no day is counted twice", () => {
    const s = stintEmploymentSummary(
      [{ startDate: "2026-09-01", endDate: "2026-09-10" }, { startDate: "2026-09-10", endDate: "2026-09-15" }, { startDate: "2026-09-16", endDate: null }],
      SEP.monthStart, SEP.monthEnd);
    expect(s.ranges).toEqual([{ from: "2026-09-01", to: "2026-09-30" }]);
    expect(s.employedDays).toBe(30);
  });

  it("ignores days before salary_start_date", () => {
    const s = stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd, "2026-09-05");
    expect(s.ranges[0]).toEqual({ from: "2026-09-05", to: "2026-09-10" });
    expect(s.employedDays).toBe(6 + 11);
  });

  it("a salary_start_date after the whole month leaves nothing", () => {
    expect(stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd, "2026-10-01").employedDays).toBe(0);
  });

  it("tolerates unsorted input and datetime strings", () => {
    const s = stintEmploymentSummary(
      [{ startDate: "2026-09-20T00:00:00.000Z", endDate: null }, { startDate: "2024-01-15", endDate: "2026-09-10T00:00:00.000Z" }],
      SEP.monthStart, SEP.monthEnd);
    expect(s.employedDays).toBe(21);
  });

  it("a stint with an end date before its start date contributes nothing", () => {
    expect(stintEmploymentSummary([{ startDate: "2026-09-20", endDate: "2026-09-10" }], SEP.monthStart, SEP.monthEnd).employedDays).toBe(0);
  });
});

describe("isDateEmployed", () => {
  const ranges = stintEmploymentSummary(rejoiner, SEP.monthStart, SEP.monthEnd).ranges;
  it("is true inside a range and on its boundaries", () => {
    expect(isDateEmployed(ranges, "2026-09-01")).toBe(true);
    expect(isDateEmployed(ranges, "2026-09-10")).toBe(true);
    expect(isDateEmployed(ranges, "2026-09-20")).toBe(true);
  });
  it("is false inside the gap", () => {
    expect(isDateEmployed(ranges, "2026-09-11")).toBe(false);
    expect(isDateEmployed(ranges, "2026-09-15")).toBe(false);
    expect(isDateEmployed(ranges, "2026-09-19")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**: `cd backend && npx vitest run src/modules/payroll/__tests__/stint-window.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
/**
 * Which days of a payroll month an employee was employed, from their employment stints.
 *
 * Pure string/integer math — no Date objects — because this codebase has a history of a local Date read back
 * as UTC shifting a payroll day (see payroll/employment-end-date.ts). 'YYYY-MM-DD' strings only.
 */

export interface Stint {
  startDate: string;
  /** null = the current, open stint. */
  endDate: string | null;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface StintSummary {
  /** Ascending, non-overlapping, inclusive, clamped to the month (and to salary_start_date when given). */
  ranges: DateRange[];
  employedDays: number;
  /** Sundays that fall inside the employed ranges. */
  sundays: number;
}

const ymd = (v: string): string => String(v).slice(0, 10);

/** Days since 1970-01-01 for a 'YYYY-MM-DD' string, via UTC midnight, so there is no timezone drift. */
export function dayNumber(date: string): number {
  const [y, m, d] = ymd(date).split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** 1970-01-01 was a Thursday, so a Sunday is a day number n with (n + 4) % 7 === 0. */
export function isSunday(date: string): boolean {
  return (((dayNumber(date) + 4) % 7) + 7) % 7 === 0;
}

const maxDate = (a: string, b: string) => (a >= b ? a : b);
const minDate = (a: string, b: string) => (a <= b ? a : b);

function addDays(date: string, n: number): string {
  const dn = dayNumber(date) + n;
  const d = new Date(dn * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function stintEmploymentSummary(
  stints: Stint[],
  monthStart: string,
  monthEnd: string,
  salaryStartDate?: string | null,
): StintSummary {
  const floor = salaryStartDate ? maxDate(ymd(monthStart), ymd(salaryStartDate)) : ymd(monthStart);
  const ceil = ymd(monthEnd);

  const clamped: DateRange[] = [];
  for (const s of stints) {
    const from = maxDate(ymd(s.startDate), floor);
    const to = minDate(s.endDate ? ymd(s.endDate) : ceil, ceil);
    if (from <= to) clamped.push({ from, to });
  }
  clamped.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  // Merge overlapping and touching ranges so no day is counted twice.
  const ranges: DateRange[] = [];
  for (const r of clamped) {
    const last = ranges[ranges.length - 1];
    if (last && r.from <= addDays(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else {
      ranges.push({ ...r });
    }
  }

  let employedDays = 0;
  let sundays = 0;
  for (const r of ranges) {
    const a = dayNumber(r.from);
    const b = dayNumber(r.to);
    employedDays += b - a + 1;
    for (let n = a; n <= b; n++) if ((((n + 4) % 7) + 7) % 7 === 0) sundays++;
  }
  return { ranges, employedDays, sundays };
}

export function isDateEmployed(ranges: DateRange[], date: string): boolean {
  const d = ymd(date);
  return ranges.some((r) => d >= r.from && d <= r.to);
}
```

- [ ] **Step 4: Run to verify it passes**: same command → PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(payroll): pure stint window math for rejoined employees`.

---

### Task 3: Week-off and holiday credit follow the stints

**Files:** modify `backend/src/modules/payroll/weekoff-eligibility.service.ts` and `backend/src/modules/payroll/holiday-work.service.ts`; tests `payroll/__tests__/weekoff-stint.test.ts`, `payroll/__tests__/holiday-stint.test.ts`.

Read both files and the existing `weekoff-holiday-aware.test.ts` / `weekoff-eligibility-slabs.test.ts` first and copy their `vi.mock` setup for the policy cache (`getPolicyValue` returning the fallback) and for the DB.

**Change 1 — `calculateWeekoffEligibility`:** add an OPTIONAL fifth parameter `employment?: { employedDays: number; sundays: number }`. When it is **undefined the function must behave exactly as today** (same code path, same result). When given: `actualCount = employment.sundays` (instead of `resolveActualWeekoffCount`), `workingDays = employment.employedDays - actualCount`, and the rest of the arithmetic (`availableWorkingDays = workingDays - safeHolidays`, `effectivePaidBase = paidBase + safeHolidays`, the "all Sundays" branch, the slab branch) is unchanged. Clamp `workingDays` at 0.

**Change 2 — `resolveHolidaysForEmployeeV2(employeeId, runMonth, employedRanges?)`:** add an OPTIONAL third parameter `employedRanges?: DateRange[]` (from `stint-window.ts`). When undefined, unchanged. When given, additionally skip any holiday whose date is not inside any range (`!isDateEmployed(employedRanges, holidayDateStr)`), next to the existing `if (holidayDateStr > payableThroughDate) continue;` checks, so a holiday inside the gap is not counted as an eligible holiday.

- [ ] **Step 1: Write the failing tests.** `weekoff-stint.test.ts` (mock setup copied from `weekoff-holiday-aware.test.ts`):

```ts
// ... same vi.mock setup as weekoff-holiday-aware.test.ts (policy fallback slabs) ...
import { calculateWeekoffEligibility } from "../weekoff-eligibility.service.js";

const SEP = "2026-09";

describe("calculateWeekoffEligibility with a stint scope", () => {
  it("without the scope it is unchanged: 24 paid days in a 30-day month gives the slab, not all Sundays", async () => {
    expect(await calculateWeekoffEligibility("e1", 24, SEP, 0)).toBe(4);
  });

  it("rejoiner employed 21 days with 3 Sundays and 18 paid days earns all 3 (no slab shortfall)", async () => {
    // employed 21, Sundays 3 -> working 18, paid 18 >= 18 -> all 3 Sundays
    expect(await calculateWeekoffEligibility("e1", 18, SEP, 0, { employedDays: 21, sundays: 3 })).toBe(3);
  });

  it("the same 18 paid days WITHOUT the scope drops into the slab (3) and is not credited the gap Sunday", async () => {
    expect(await calculateWeekoffEligibility("e1", 18, SEP, 0)).toBe(3);
  });

  it("a rejoiner who missed a day in the stint falls into the slab on the employed working days", async () => {
    // employed 21, Sundays 3 -> working 18, paid 17 < 18 -> slab(17) = 2, min(2, 3) = 2
    expect(await calculateWeekoffEligibility("e1", 17, SEP, 0, { employedDays: 21, sundays: 3 })).toBe(2);
  });

  it("holidays inside employment count toward the full-attendance test", async () => {
    // employed 21, Sundays 3 -> working 18; 1 holiday -> available 17; paid 16 + 1 holiday = 17 >= 17 -> all 3
    expect(await calculateWeekoffEligibility("e1", 16, SEP, 1, { employedDays: 21, sundays: 3 })).toBe(3);
  });

  it("never returns more Sundays than were inside employment", async () => {
    expect(await calculateWeekoffEligibility("e1", 30, SEP, 0, { employedDays: 21, sundays: 3 })).toBe(3);
  });

  it("zero employed days earns nothing", async () => {
    expect(await calculateWeekoffEligibility("e1", 0, SEP, 0, { employedDays: 0, sundays: 0 })).toBe(0);
  });
});
```

(Check each expectation against the real slab table in the policy fallback — `0-6:0, 7-11:1, 12-17:2, 18-23:3, 24-25:4, 26-31:5` — and the real function body; if a hand-computed number is wrong because of the boundary rule, fix the expectation and say why, never the intent.)

`holiday-stint.test.ts`: mock the DB the way `payroll-line-coverage.test.ts` does (`vi.mock("../../../db/mysql.js", ...)` with ordered `mockResolvedValueOnce` rows) so `resolveHolidaysForEmployeeV2` sees an employee row and holidays on `2026-09-05` and `2026-09-15` (check the real query order in the file), then assert: no `employedRanges` → both counted (unchanged); with `employedRanges` for Sep 1-10 and Sep 20-30 → only 2026-09-05 counted; the holiday on 2026-09-15 (inside the gap) is dropped.

- [ ] **Step 2: Run to verify they fail**, implement the two optional parameters, run to pass: `cd backend && npx vitest run src/modules/payroll/__tests__/weekoff-stint.test.ts src/modules/payroll/__tests__/holiday-stint.test.ts src/modules/payroll/__tests__/weekoff-holiday-aware.test.ts src/modules/payroll/__tests__/weekoff-eligibility-slabs.test.ts` (the last two are the existing tests and must pass untouched) and `npx tsc --noEmit`.

- [ ] **Step 3: Commit** `feat(payroll): week-off and holiday credit can be limited to employment stints`.

---

### Task 4: Wire it into the payroll calculation, behind the flag

**Files:** create `backend/src/modules/payroll/stint-payroll.service.ts` and `payroll/__tests__/stint-payroll.service.test.ts`; modify `backend/src/modules/payroll/payrollCalculate.service.ts`; add `payroll/__tests__/stint-payroll-wiring.contract.test.ts`.

**`stint-payroll.service.ts`:**

```ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { stintEmploymentSummary, type Stint, type StintSummary } from "./stint-window.js";

export const STINT_PAYROLL_FLAG_KEY = "rejoin_stint_payroll_enabled";

interface Executor {
  execute<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/** Default OFF: a missing row, a non-'true' value or ANY read error means the flag is off. */
export async function isStintPayrollEnabled(exec: Executor = db as unknown as Executor): Promise<boolean> {
  try {
    const [rows] = await exec.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ? LIMIT 1`,
      [STINT_PAYROLL_FLAG_KEY],
    );
    if (!rows.length) return false;
    return String(rows[0]!.config_value).trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

export interface StintScope extends StintSummary {
  stints: Stint[];
}

/**
 * Stint scope for the employees of a run who have employment_stint rows (that is, rejoiners — stint 1 is only
 * ever written together with stint 2). Employees with no rows are NOT in the map and follow the unchanged
 * payroll path. ALL of an employee's stints are loaded, not just the ones overlapping the month: merging and
 * clamping happen in stintEmploymentSummary, and a month wholly inside the gap must still be recognised as
 * "a rejoiner with zero employed days" rather than "an employee with no stints".
 */
export async function loadStintScopes(
  employeeIds: string[],
  monthStart: string,
  monthEnd: string,
  salaryStartByEmployee: Map<string, string | null>,
  exec: Executor = db as unknown as Executor,
): Promise<Map<string, StintScope>> {
  const out = new Map<string, StintScope>();
  if (employeeIds.length === 0) return out;
  const placeholders = employeeIds.map(() => "?").join(",");
  const [rows] = await exec.execute<RowDataPacket[]>(
    `SELECT employee_id,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
       FROM employment_stint
      WHERE employee_id IN (${placeholders})
      ORDER BY employee_id, stint_no`,
    employeeIds,
  );
  const byEmployee = new Map<string, Stint[]>();
  for (const r of rows) {
    const id = String(r.employee_id);
    const list = byEmployee.get(id) ?? [];
    list.push({ startDate: String(r.start_date), endDate: r.end_date ?? null });
    byEmployee.set(id, list);
  }
  for (const [id, stints] of byEmployee) {
    const summary = stintEmploymentSummary(stints, monthStart, monthEnd, salaryStartByEmployee.get(id) ?? null);
    out.set(id, { ...summary, stints });
  }
  return out;
}
```

If the run has thousands of employees, chunk `employeeIds` (e.g. 1000 per query); look at how `payrollCalculate` already batches its other `IN (...)` queries and copy that.

**Calculator wiring (`payrollCalculate.service.ts`):** read the file around the anchors below (line numbers are approximate) and make the smallest possible edits; the flag-off path must stay **byte-for-byte equivalent in behaviour**.

1. Once per run, before the employee loop (near the other per-run reads, e.g. the `payroll_head_review_gate_enabled` read at `~:938-950`): `const stintPayrollOn = await isStintPayrollEnabled();`, and, if on, after the employee rows are loaded: `const stintScopes = stintPayrollOn ? await loadStintScopes(empRows.map(e => e.employee_id), loopMonthStart, loopMonthEnd, new Map(empRows.map(e => [e.employee_id, e.salary_start_date ?? null]))) : new Map<string, StintScope>();`.
2. Inside the per-employee loop, right after the existing "start is after the month end → continue" skip (`~:1318-1326`): `const stintScope = stintPayrollOn ? stintScopes.get(emp.employee_id) : undefined; if (stintScope && stintScope.employedDays === 0) { /* wholly inside the gap: no line, same as the existing skip */ continue; }` — mirror whatever the existing skip does with counters/logging so the two skips are consistent.
3. Holidays `~:1366`: `resolveHolidaysForEmployeeV2(emp.employee_id, run.run_month, stintScope?.ranges)`.
4. Week-offs `~:1367`: `calculateWeekoffEligibility(emp.employee_id, paidBase, run.run_month, eligibleHolidayCount, stintScope ? { employedDays: stintScope.employedDays, sundays: stintScope.sundays } : undefined)`.
5. `activeCals` `~:1480`: `const activeCals = stintScope ? Math.min(stintScope.employedDays, daysInMonth) : (() => { ...the existing IIFE, untouched... })();`. (The existing `Math.max(1, ...)` floor stays inside the old IIFE; the stint branch cannot be 0 here because step 2 skipped that case.)
6. Nothing else changes: `payableDaysOverride`, `finalPayableDays = Math.min(basePayableDays, activeCals)`, gross proration and everything downstream stay as they are, which is what makes an override unable to pay the gap.

- [ ] **Step 1: Write the failing tests.**

`stint-payroll.service.test.ts` (fake executor keyed by SQL substring, like the other rejoin tests):
- `isStintPayrollEnabled`: missing row → false; `'true'` → true; `'TRUE '` → true; `'false'` → false; `'yes'` → false; executor throws → false.
- `loadStintScopes`: for two employees where only one has stint rows, only that one is in the map; the stints are summarised for the month (September scenario: 21 days, 3 Sundays); a rejoiner whose month lies wholly inside the gap IS in the map with `employedDays: 0` (so the calculator can skip them); `salary_start_date` is honoured; an empty id list does no query; the SQL binds all ids.

`stint-payroll-wiring.contract.test.ts` (source-text guard on `payrollCalculate.service.ts`, like `leaver-resolver-wiring.contract.test.ts`):
- imports `isStintPayrollEnabled` and `loadStintScopes`;
- every use of `stintScope` / `stintScopes` sits behind the flag: assert the source contains `stintPayrollOn ?` and that `loadStintScopes(` appears only inside a `stintPayrollOn ?` expression;
- the three call sites pass the scope: `resolveHolidaysForEmployeeV2(emp.employee_id, run.run_month, stintScope?.ranges)`, `calculateWeekoffEligibility(` followed (within 300 chars) by `stintScope`, and `const activeCals = stintScope ?`;
- the original resolver wiring is untouched (the existing `leaver-resolver-wiring.contract.test.ts` still passes: `employmentWindowPredicate()` and `payableThrough(emp.employment_end_date` are still present);
- the old `activeCals` IIFE text (`payableThrough(emp.employment_end_date, monthEnd)`) is still present (flag-off path preserved).

- [ ] **Step 2: Run to verify they fail**: `cd backend && npx vitest run src/modules/payroll/__tests__/stint-payroll.service.test.ts src/modules/payroll/__tests__/stint-payroll-wiring.contract.test.ts` → FAIL.

- [ ] **Step 3: Implement** the service and the calculator edits above.

- [ ] **Step 4: Run to verify**: `cd backend && npx vitest run src/modules/payroll` (the whole payroll directory: all existing payroll tests must still pass, especially `leaver-resolver-wiring.contract.test.ts`, `employment-end-date.test.ts`, `employmentEndDateRejoined.contract.test.ts`, `weekoff-*`, `payroll-line-coverage.test.ts`) and `npx tsc --noEmit`. Expected: green. Any existing payroll test that fails because it pins calculator source text you had to edit: update that assertion minimally to the new text and say so, never weaken what it protects.

- [ ] **Step 5: Commit** `feat(payroll): pay rejoined employees only for their employment stints (flag off by default)`.

---

### Task 5: Verify (real MySQL for the loader, numbers, full suite)

- [ ] **Step 1: Loader SQL on a real MySQL.** Throwaway `mysql:8.0` container (unique name `rejoin3c-scratch`, `--rm`, collation `utf8mb4_unicode_ci`, removed at the end; touch nothing else, no real database). Build `employment_stint` (from `migrations/2079_employee_rejoin_v3.sql`) and `payroll_config_flags` (from `sql/330_payroll_recalc_queue_and_config.sql`). Apply 2081 **twice**: after the second run there must be exactly **one** global row for `rejoin_stint_payroll_enabled` with value `'false'`. Through a real `mysql2` pool (production options: `dateStrings`, timezone `+05:30`, `decimalNumbers`) run `isStintPayrollEnabled` (absent → false; 'false' → false; set to 'true' → true) and `loadStintScopes` for seeded rejoiners and non-rejoiners; check the September scenario returns 21 days / 3 Sundays, the next month returns the full month, the wholly-in-gap month returns `employedDays: 0`, and a non-rejoiner is absent from the map.
- [ ] **Step 2: End-to-end numbers.** In a vitest file in the scratchpad (not the repo) combine the real pure functions to reproduce the traced scenario with the production slab table: September 2026, 18 present days, no holidays → flag-on payable days **21** (3 + 18); with a holiday on Sep 15 (inside the gap) and a holiday on Sep 5 (inside) → the Sep 15 one is dropped, payable = 18 + 3 + 1 = 22 (not 23); flag-off reproduces today's numbers exactly (same function calls without the scope). Also assert that a payroll-head override of 30 payable days is capped at 21 with the scope and at 30 without it (documenting that the flag is what closes that hole).
- [ ] **Step 3: Full suite.** `cd backend && npm run build`, then the whole `npx vitest run` IN THE BACKGROUND with output to a file under the scratchpad; wait by polling the file for the `Test Files` summary (a clean run is ~7 minutes; first check `ps` for any other vitest process belonging to `/home/shuvam/hrms-rejoin-3` and report it; ignore ones under `/home/shuvam/hrms-rejoin`). The only failing files must be the 3 known pre-existing ones (plus the known 5 unhandled errors from `exitFsm.transitions.contract.test.ts`). Run `graphify update .` only if the command exists; do not commit `graphify-out`.
- [ ] **Step 4:** Tear down the container; commit any fixes as `fix(payroll): align stint payroll with the real schema` (skip if none). Report plainly what was and was not verified: the calculator itself has no direct unit test and was NOT run against a real payroll run; db_bill reconciliation of a recalculated month with the flag on is the owner's pre-enable check and is not done here.

---

## Self-Review

**Spec coverage:** "Pay the old stint through the old LWD and the new stint from the rejoin date; gap unpaid and not LOP" → Tasks 2-4 (employed-days cap, week-off and holiday credit limited to stints; the gap earns nothing and creates no LOP). "Split-month payslip behind a flag, off by default" → one payslip line per month with the prorated days (the calculator already produces one line per employee per month; the "two components" in the original spec are not needed because proration is by days, so the split is visible in `final_payable_days`, not as two lines). "If F&F was paid for the month being rejoined, raise a recovery flag to payroll, never auto-deduct" → **not built here**: it needs a decision about where payroll surfaces such a flag; the audit row `rejoin_activated` already records `ffAlreadyPaid`, and the notification for it is a follow-up. "End-date resolver ignores `rejoined` exit rows" → already pinned by `employmentEndDateRejoined.contract.test.ts` (Plan 1).

**Placeholders:** none in the code that matters; Task 3's holiday test and Task 4's calculator edits are specified by anchors and behaviour because the files are large and must be read first (the implementer is told exactly what each edit must do and what must stay unchanged).

**Type consistency:** `Stint`, `DateRange`, `StintSummary`, `stintEmploymentSummary(stints, monthStart, monthEnd, salaryStartDate?)`, `isDateEmployed(ranges, date)` (Task 2) are used identically in Tasks 3-4; `StintScope extends StintSummary` carries `ranges`/`employedDays`/`sundays` exactly as the calculator edits read them; the optional `employment: {employedDays, sundays}` argument matches between Task 3 and Task 4.

**Risks:** the calculator is ~2.7k lines with source-text contract tests; edits must be minimal and the flag-off path unchanged (contract test). A flag flip changes real salaries, which is why it ships OFF and why the owner should recalculate a rejoiner's month and compare it to db_bill before enabling.
