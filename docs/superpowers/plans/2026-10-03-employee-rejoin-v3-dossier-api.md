# Employee Rejoin v3 — Dossier API (Plan 2a of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One endpoint, `GET /api/employees/reactivation/:id/dossier`, that returns everything the branch head needs to judge a rejoin request: header, attendance, late coming, KPI, leave, learning, conduct, exit file, payroll footprint, a timeline, and an advisory verdict. All data is pulled automatically from existing tables.

**Architecture:** Each dossier section is its own small loader (`dossier.<section>.ts`) taking `(db, window)` and returning typed data. A pure `buildVerdict` turns a few numbers into Strong / Average / Weak / Insufficient data plus plain-language reasons. An aggregator runs all loaders with per-section failure isolation (one failing section shows an error in its own card, the page still loads). A thin router adds role and branch scope checks.

**Tech Stack:** TypeScript, Express, mysql2, vitest + supertest. Spec: `docs/superpowers/specs/2026-10-03-employee-rejoin-v3-design.md`. Builds on Plan 1 (`docs/superpowers/plans/2026-10-03-employee-rejoin-v3-core.md`, already implemented on branch `feat/rejoin-v3`).

**Plan series:** 1 core (done) → **2a dossier API (this)** → 2b branch head page (written after 2a, once the real response shape exists) → 3 payroll split-month, ATS duplicate catch, reminders, backfill, live audit.

**Working directory:** worktree `/home/shuvam/hrms-rejoin` (branch `feat/rejoin-v3`). Run backend commands from `backend/`. Never push, never touch prod.

---

## Verified data facts the code below relies on (from a read of the repo; no prod access)

- `attendance_daily_record`: `employee_id, record_date, attendance_status` (`present, half_day, absent, leave_approved, holiday, week_off, unreconciled, missing_punch, week_off_worked`), `lwp_value`, `late_mark` (1/0), `late_by_minutes`. Late is **not** a status. No worked-hours column.
- `attendance_regularization`: `employee_id, session_date, status` (`pending, manager_approved, approved, branch_head_approved, rejected`).
- KPI: `kpi_score(employee_id, metric_id, period 'YYYY-MM', actual_value)`, `kpi_metric_master(id, metric_name, direction)`, `kpi_process_config(metric_id, process_id, target_value, effective_from)`; optional `kpi_score_summary(employee_id, period_id, final_score, rating, status)` + `kpi_score_period(id, period_start)`. The summary table is likely empty on prod, so it is LEFT-joined/optional.
- `leave_request(employee_id, leave_type_id, from_date, to_date, total_days, status, applied_at, leave_type_code)`; counted leave = status `approved` / `branch_head_approved`. `leave_type_master(id, leave_name, paid_leave)`. There is **no** planned/unplanned column: the dossier derives "short notice" (applied on or after the day before start) and "weekend-adjacent" (starts Monday or ends Friday).
- `leave_balance_ledger(employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)`.
- LMS: `lms_learning_progress_snapshot(employee_id, course_name, completion_pct, status)`, `lms_certification_snapshot(employee_id, certification_name, issued_date, expiry_date, status)`.
- Conduct: `employee_warning(employee_id, warning_date, category, severity verbal|written|final, status active|withdrawn, description)`, `pip_record(employee_id, start_date, end_date, status active|completed|extended|terminated, outcome, reason)`, `performance_alert(employee_id, severity, acknowledged)`, `coaching_session(employee_id, status)`, `employee_rehire_control` and `employment_stint` (migration 2079), `employee_reactivation_requests`.
- Exit: `exit_request(id, employee_id, exit_type, exit_sub_type, exit_reason_category, resignation_reason, absconding_since, last_working_day_confirmed, last_working_day_proposed, notice_period_days, notice_start_date, status, created_at)`, `exit_clearance_checklist(exit_request_id, department, status, remarks)`, `asset_assignment(asset_id, employee_id, assigned_date, returned_date)` + `asset_master(id, asset_name, asset_category)`, `full_final_calculation(exit_request_id, employee_id, net_payable, status, ff_paid_at)`.
- Payroll: `salary_prep_line(employee_id, run_id, gross_salary, net_salary, total_deductions, status)` joined to `salary_prep_run(id, run_month 'YYYY-MM', status)`; visible run statuses `locked, finalized, approved, disbursed, completed`. Recoveries: `employee_loans(employee_id, status, pending_amount)`, `salary_advance_log(employee_id, amount, recovered_amount)`, `employee_deduction_entries(employee_id, status, amount)`. Salary history: `employee_salary_history(employee_id, gross, ctc, is_current)`.
- Timeline: `employee_journey_log(employee_id, event_type, event_date, description)`, `employee_job_history(employee_id, effective_date, change_type, reason)`, `promotion_record(employee_id, effective_date, status)`, `transfer_record(employee_id, effective_date, transfer_type, from_value, to_value, status)`. (`db_audit` is a separate call-quality database, **not** an audit table — do not use it.)
- Header joins: `branch_master(id, branch_name)`, `process_master(id, process_name)`, `designation_master(id, designation_name)`, `department_master(id, dept_name)`, `employees.reporting_manager_id` self-join.
- Status columns that are VARCHAR (`exit_request.status`, `exit_clearance_checklist.status`) are compared with `LOWER(...)`.

Some column names above (promotion/transfer/job-history/loan/advance/deduction tables) were read from SQL files, not a live DB. Every loader that touches them is wrapped so a wrong column degrades to an empty/err section instead of a 500, and **Task 9** verifies each query against a scratch MySQL built from the repo SQL.

## The window

The dossier looks at the 12 months **ending on the employee's last working day** (the end of the previous stint), not "today". If there is no end date it falls back to today. This is what the branch head is judging: how the person performed before they left.

## File Structure

All new files under `backend/src/modules/employees/rehire/dossier/` unless noted.

| File | Responsibility |
|---|---|
| `dossierTypes.ts` | `DossierWindow`, `buildWindow`, `SectionResult`, `settle`, number helpers |
| `dossierVerdict.ts` | Pure `buildVerdict` + `DEFAULT_THRESHOLDS` |
| `dossier.attendance.ts` | Attendance by month, late coming, regularizations |
| `dossier.kpi.ts` | KPI by month, pure `achievementPct` |
| `dossier.people.ts` | Leave and learning |
| `dossier.conduct.ts` | Warnings, PIPs, alerts, coaching, rehire flag, prior absconding / rejoins |
| `dossier.exit.ts` | Latest exit file: reason, notice, clearance, assets, F&F |
| `dossier.payroll.ts` | Last 12 payslips, recoveries, salary |
| `dossier.header.ts` | Employee header + tenure |
| `dossier.timeline.ts` | Pure `buildTimeline` + loader merging history tables |
| `dossierService.ts` | `buildDossier(db, requestId)` aggregator |
| `backend/src/modules/employees/rejoin-dossier.routes.ts` | Express router, role + scope gate |
| `backend/src/app.ts` | Mount the router (one line next to the reactivation router at ~line 653) |
| `dossier/__tests__/*.test.ts` | One test file per unit above |

Shared test helper pattern (each test file defines its own copy): a fake executor that returns rows by substring match on the SQL.

```ts
function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
```

---

### Task 1: Types, window, helpers

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossierTypes.ts`
- Test: `backend/src/modules/employees/rehire/dossier/__tests__/dossierTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildWindow, settle, num, numOrNull, round1 } from "../dossierTypes.js";

describe("buildWindow", () => {
  it("covers 12 months ending in the as-of month", () => {
    const w = buildWindow("e1", "2026-09-10", 12);
    expect(w.months).toHaveLength(12);
    expect(w.months[0]).toBe("2025-10");
    expect(w.months[11]).toBe("2026-09");
    expect(w.start).toBe("2025-10-01");
    expect(w.end).toBe("2026-09-10");
    expect(w.employeeId).toBe("e1");
  });

  it("crosses a year boundary", () => {
    expect(buildWindow("e1", "2026-01-15", 3).months).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("accepts a datetime string as the as-of date", () => {
    expect(buildWindow("e1", "2026-09-10T00:00:00.000Z", 1).end).toBe("2026-09-10");
  });
});

describe("settle", () => {
  it("wraps a value", async () => {
    expect(await settle(async () => 5)).toEqual({ status: "ok", data: 5 });
  });
  it("turns a throw into an error section instead of rejecting", async () => {
    const r = await settle(async () => { throw new Error("boom"); });
    expect(r).toEqual({ status: "error", error: "boom" });
  });
});

describe("number helpers", () => {
  it("num coerces mysql2 decimal strings and defaults to 0", () => {
    expect(num("12.50")).toBe(12.5);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num("abc")).toBe(0);
  });
  it("numOrNull keeps null", () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull("3")).toBe(3);
  });
  it("round1 rounds to one decimal", () => {
    expect(round1(94.449)).toBe(94.4);
    expect(round1(94.45)).toBe(94.5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossierTypes.test.ts`
Expected: FAIL — cannot resolve `../dossierTypes.js`.

- [ ] **Step 3: Write the implementation**

```ts
import type { SqlExecutor } from "../rehireFacts.js";

export type { SqlExecutor };

/** The span the dossier looks at. `months` are 'YYYY-MM', ascending; start/end are 'YYYY-MM-DD'. */
export interface DossierWindow {
  employeeId: string;
  start: string;
  end: string;
  months: string[];
}

/**
 * `monthsBack` calendar months ending in the month of `asOf`. Pure string/integer math — no Date —
 * so the day can never shift by a timezone (this codebase has a history of that bug).
 */
export function buildWindow(employeeId: string, asOf: string, monthsBack = 12): DossierWindow {
  const end = asOf.slice(0, 10);
  const [y, m] = end.slice(0, 7).split("-").map(Number) as [number, number];
  const months: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    months.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return { employeeId, start: `${months[0]}-01`, end, months };
}

/** A section either loaded or failed on its own; one bad query must not blank the whole page. */
export type SectionResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

export async function settle<T>(fn: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    return { status: "ok", data: await fn() };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** mysql2 returns SUM()/DECIMAL as strings. */
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const round1 = (n: number): number => Math.round(n * 10 + Number.EPSILON * 10) / 10;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossierTypes.test.ts`
Expected: PASS. If `round1(94.45)` yields `94.4`, replace the body with `Math.round((n + Number.EPSILON) * 10) / 10` and rerun.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/employees/rehire/dossier
git commit -m "feat(rejoin-dossier): window, settle and number helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Verdict (pure)

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossierVerdict.ts`
- Test: `backend/src/modules/employees/rehire/dossier/__tests__/dossierVerdict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildVerdict, DEFAULT_THRESHOLDS, type VerdictInputs } from "../dossierVerdict.js";

const good: VerdictInputs = {
  attendancePct: 96, avgLateMarksPerMonth: 1, kpiMonthsAtTargetPct: 85, kpiMonthsWithData: 10,
  activeWarnings: 0, finalWarnings: 0, openPip: false, priorAbsconding: false, tenureMonths: 14,
};
const v = (o: Partial<VerdictInputs>) => buildVerdict({ ...good, ...o });

describe("buildVerdict", () => {
  it("rates a clean, strong record as strong", () => {
    const r = v({});
    expect(r.rating).toBe("strong");
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.length).toBeLessThanOrEqual(5);
  });

  it("a final warning is weak regardless of numbers", () => {
    const r = v({ finalWarnings: 1, activeWarnings: 1 });
    expect(r.rating).toBe("weak");
    expect(r.reasons.some((x) => x.tone === "bad" && /final warning/i.test(x.text))).toBe(true);
  });

  it("two bad signals are weak", () => {
    expect(v({ attendancePct: 80, avgLateMarksPerMonth: 7 }).rating).toBe("weak");
  });

  it("one bad signal is average", () => {
    expect(v({ attendancePct: 85 }).rating).toBe("average");
  });

  it("no bad but fewer than two good signals is average", () => {
    expect(v({ attendancePct: 92, avgLateMarksPerMonth: 3, kpiMonthsAtTargetPct: 70, tenureMonths: 5 }).rating).toBe("average");
  });

  it("an open PIP and prior absconding count as bad", () => {
    const r = v({ openPip: true, priorAbsconding: true });
    expect(r.rating).toBe("weak");
  });

  it("says insufficient data when there is no attendance and little KPI history", () => {
    const r = v({ attendancePct: null, avgLateMarksPerMonth: null, kpiMonthsAtTargetPct: null, kpiMonthsWithData: 0 });
    expect(r.rating).toBe("insufficient_data");
  });

  it("conduct problems still make it weak even with no performance data", () => {
    const r = v({ attendancePct: null, avgLateMarksPerMonth: null, kpiMonthsAtTargetPct: null, kpiMonthsWithData: 0, finalWarnings: 1 });
    expect(r.rating).toBe("weak");
  });

  it("ignores KPI when fewer than 3 months have data", () => {
    const r = v({ kpiMonthsAtTargetPct: 10, kpiMonthsWithData: 2 });
    expect(r.reasons.some((x) => /kpi/i.test(x.text) && x.tone === "bad")).toBe(false);
  });

  it("uses the supplied thresholds", () => {
    const strict = buildVerdict({ ...good, attendancePct: 96 }, { ...DEFAULT_THRESHOLDS, minAttendancePct: 99 });
    expect(strict.reasons.some((x) => x.tone === "bad" && /attendance/i.test(x.text))).toBe(true);
  });

  it("never returns more than five reasons, bad ones first", () => {
    const r = v({ attendancePct: 70, avgLateMarksPerMonth: 9, kpiMonthsAtTargetPct: 10, openPip: true, activeWarnings: 2, priorAbsconding: true });
    expect(r.reasons.length).toBe(5);
    expect(r.reasons[0]!.tone).toBe("bad");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossierVerdict.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Advisory rating of an employee's record, for the branch head. It is an input to the decision,
 * never the decision: the page shows the reasons next to the numbers they came from.
 * Pure on purpose, so the rules are testable and the thresholds are config, not buried in SQL.
 */

export type Rating = "strong" | "average" | "weak" | "insufficient_data";

export interface VerdictInputs {
  attendancePct: number | null;
  avgLateMarksPerMonth: number | null;
  kpiMonthsAtTargetPct: number | null;
  kpiMonthsWithData: number;
  activeWarnings: number;
  finalWarnings: number;
  openPip: boolean;
  priorAbsconding: boolean;
  tenureMonths: number | null;
}

export interface VerdictThresholds {
  minAttendancePct: number;
  goodAttendancePct: number;
  maxLateMarksPerMonth: number;
  goodLateMarksPerMonth: number;
  minKpiAtTargetPct: number;
  goodKpiAtTargetPct: number;
  minKpiMonths: number;
  goodTenureMonths: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  minAttendancePct: 90,
  goodAttendancePct: 95,
  maxLateMarksPerMonth: 5,
  goodLateMarksPerMonth: 2,
  minKpiAtTargetPct: 60,
  goodKpiAtTargetPct: 80,
  minKpiMonths: 3,
  goodTenureMonths: 12,
};

export interface VerdictReason {
  tone: "good" | "bad" | "neutral";
  text: string;
}

export interface DossierVerdict {
  rating: Rating;
  reasons: VerdictReason[];
}

const MAX_REASONS = 5;

export function buildVerdict(i: VerdictInputs, t: VerdictThresholds = DEFAULT_THRESHOLDS): DossierVerdict {
  const bad: VerdictReason[] = [];
  const good: VerdictReason[] = [];
  const neutral: VerdictReason[] = [];

  if (i.finalWarnings > 0) {
    bad.push({ tone: "bad", text: `Has a final warning on record (${i.activeWarnings} active warning${i.activeWarnings === 1 ? "" : "s"} in total).` });
  } else if (i.activeWarnings > 0) {
    bad.push({ tone: "bad", text: `${i.activeWarnings} active warning${i.activeWarnings === 1 ? "" : "s"} on record.` });
  }
  if (i.openPip) bad.push({ tone: "bad", text: "Was on an open performance improvement plan." });
  if (i.priorAbsconding) bad.push({ tone: "bad", text: "Has an absconding exit on record." });

  if (i.attendancePct !== null) {
    if (i.attendancePct < t.minAttendancePct) {
      bad.push({ tone: "bad", text: `Attendance ${i.attendancePct}% is below ${t.minAttendancePct}%.` });
    } else if (i.attendancePct >= t.goodAttendancePct) {
      good.push({ tone: "good", text: `Attendance ${i.attendancePct}% is strong.` });
    } else {
      neutral.push({ tone: "neutral", text: `Attendance ${i.attendancePct}%.` });
    }
  }
  if (i.avgLateMarksPerMonth !== null) {
    if (i.avgLateMarksPerMonth > t.maxLateMarksPerMonth) {
      bad.push({ tone: "bad", text: `Averaged ${i.avgLateMarksPerMonth} late marks a month (limit ${t.maxLateMarksPerMonth}).` });
    } else if (i.avgLateMarksPerMonth <= t.goodLateMarksPerMonth) {
      good.push({ tone: "good", text: `Rarely late (${i.avgLateMarksPerMonth} late marks a month).` });
    } else {
      neutral.push({ tone: "neutral", text: `${i.avgLateMarksPerMonth} late marks a month on average.` });
    }
  }
  if (i.kpiMonthsWithData >= t.minKpiMonths && i.kpiMonthsAtTargetPct !== null) {
    if (i.kpiMonthsAtTargetPct < t.minKpiAtTargetPct) {
      bad.push({ tone: "bad", text: `KPI at target in only ${i.kpiMonthsAtTargetPct}% of ${i.kpiMonthsWithData} months.` });
    } else if (i.kpiMonthsAtTargetPct >= t.goodKpiAtTargetPct) {
      good.push({ tone: "good", text: `KPI at target in ${i.kpiMonthsAtTargetPct}% of ${i.kpiMonthsWithData} months.` });
    } else {
      neutral.push({ tone: "neutral", text: `KPI at target in ${i.kpiMonthsAtTargetPct}% of ${i.kpiMonthsWithData} months.` });
    }
  }
  if (i.tenureMonths !== null) {
    if (i.tenureMonths >= t.goodTenureMonths) good.push({ tone: "good", text: `Served ${i.tenureMonths} months.` });
    else neutral.push({ tone: "neutral", text: `Short tenure: ${i.tenureMonths} months.` });
  }

  const hasPerformanceData = i.attendancePct !== null || i.kpiMonthsWithData >= t.minKpiMonths;
  let rating: Rating;
  if (i.finalWarnings > 0 || bad.length >= 2) rating = "weak";
  else if (!hasPerformanceData) rating = "insufficient_data";
  else if (bad.length === 0 && good.length >= 2) rating = "strong";
  else rating = "average";

  const reasons = [...bad, ...good, ...neutral].slice(0, MAX_REASONS);
  if (rating === "insufficient_data") {
    reasons.unshift({ tone: "neutral", text: "Not enough attendance or KPI history to rate this employee." });
  }
  return { rating, reasons: reasons.slice(0, MAX_REASONS) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossierVerdict.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/employees/rehire/dossier
git commit -m "feat(rejoin-dossier): advisory verdict with configurable thresholds

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Attendance and late-coming loader

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossier.attendance.ts`
- Test: `backend/src/modules/employees/rehire/dossier/__tests__/dossier.attendance.test.ts`

Attendance percentage here is `(present + 0.5 × half_day + approved leave) ÷ working days × 100`, where working days exclude `week_off` and `holiday`. This differs from the Employee 360 page (which divides by every recorded day, diluting the figure with week-offs); the difference is deliberate and noted in the code.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { loadAttendanceSection } from "../dossier.attendance.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 3);

const monthRows = [
  { month: "2026-07", working_days: "26", present_days: "24", half_days: "1", absent_days: "1", leave_days: "0", missing_punch: "0", late_marks: "2", lop_days: "1.50", late_minutes: "40" },
  { month: "2026-08", working_days: "26", present_days: "22", half_days: "0", absent_days: "0", leave_days: "2", missing_punch: "1", late_marks: "6", lop_days: "0.00", late_minutes: "90" },
];

describe("loadAttendanceSection", () => {
  it("builds monthly rows and totals from the query", async () => {
    const ex = executor({
      "FROM attendance_daily_record": monthRows,
      "FROM attendance_regularization": [{ status: "approved", n: 3 }, { status: "branch_head_approved", n: 1 }, { status: "rejected", n: 2 }, { status: "manager_approved", n: 1 }],
    });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.months).toHaveLength(2);
    expect(s.months[0]).toMatchObject({ month: "2026-07", workingDays: 26, present: 24, halfDay: 1, absent: 1, lateMarks: 2, lopDays: 1.5 });
    expect(s.totals).toMatchObject({ workingDays: 52, present: 46, halfDay: 1, leave: 2, lateMarks: 8 });
    // (46 + 0.5*1 + 2) / 52 * 100 = 93.27 -> 93.3
    expect(s.attendancePct).toBe(93.3);
  });

  it("derives late coming: average per month, average minutes, worst month", async () => {
    const ex = executor({ "FROM attendance_daily_record": monthRows, "FROM attendance_regularization": [] });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.late.totalLateMarks).toBe(8);
    expect(s.late.avgLateMarksPerMonth).toBe(4); // 8 / 2 months with data
    expect(s.late.avgLateMinutes).toBe(16.3); // 130 / 8
    expect(s.late.worstMonth).toEqual({ month: "2026-08", lateMarks: 6 });
  });

  it("buckets regularizations: approved, rejected, pending", async () => {
    const ex = executor({
      "FROM attendance_daily_record": monthRows,
      "FROM attendance_regularization": [{ status: "approved", n: 3 }, { status: "branch_head_approved", n: 1 }, { status: "rejected", n: 2 }, { status: "manager_approved", n: 1 }, { status: "pending", n: 4 }],
    });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.regularizations).toEqual({ total: 11, approved: 4, rejected: 2, pending: 5 });
  });

  it("returns nulls, not zeros, when there is no attendance at all", async () => {
    const ex = executor({ "FROM attendance_daily_record": [], "FROM attendance_regularization": [] });
    const s = await loadAttendanceSection(ex as never, w);
    expect(s.months).toEqual([]);
    expect(s.attendancePct).toBeNull();
    expect(s.late.avgLateMarksPerMonth).toBeNull();
    expect(s.late.avgLateMinutes).toBeNull();
    expect(s.late.worstMonth).toBeNull();
  });

  it("binds the employee and window to the attendance query", async () => {
    const ex = executor({ "FROM attendance_daily_record": [], "FROM attendance_regularization": [] });
    await loadAttendanceSection(ex as never, w);
    const call = ex.execute.mock.calls.find(([sql]) => String(sql).includes("FROM attendance_daily_record"))!;
    expect(call[1]).toEqual(["e1", w.start, w.end]);
  });

  it("caps attendance at 100", async () => {
    const ex = executor({
      "FROM attendance_daily_record": [{ month: "2026-08", working_days: "10", present_days: "10", half_days: "0", absent_days: "0", leave_days: "2", missing_punch: "0", late_marks: "0", lop_days: "0", late_minutes: "0" }],
      "FROM attendance_regularization": [],
    });
    expect((await loadAttendanceSection(ex as never, w)).attendancePct).toBe(100);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.attendance.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
import type { RowDataPacket } from "mysql2";
import { num, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface AttendanceMonth {
  month: string;
  workingDays: number;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  missingPunch: number;
  lateMarks: number;
  lopDays: number;
  lateMinutes: number;
}

export interface AttendanceTotals {
  workingDays: number;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  missingPunch: number;
  lateMarks: number;
  lopDays: number;
  lateMinutes: number;
}

export interface AttendanceSection {
  months: AttendanceMonth[];
  totals: AttendanceTotals;
  /** (present + 0.5 x half_day + approved leave) / working days x 100, capped at 100. */
  attendancePct: number | null;
  regularizations: { total: number; approved: number; rejected: number; pending: number };
  late: {
    totalLateMarks: number;
    avgLateMarksPerMonth: number | null;
    avgLateMinutes: number | null;
    worstMonth: { month: string; lateMarks: number } | null;
  };
}

// Status semantics copied from payroll/payrollCalculate.service.ts and analytics/employee-360.service.ts:
// 'late' is NOT an attendance_status — a late day is late_mark = 1 on a present row. Working days exclude
// week_off and holiday. The percentage deliberately divides by WORKING days (Employee 360 divides by every
// recorded day, which dilutes the figure with week-offs).
const ATTENDANCE_SQL = `
  SELECT DATE_FORMAT(record_date, '%Y-%m') AS month,
         COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END) AS working_days,
         SUM(attendance_status = 'present') AS present_days,
         SUM(attendance_status = 'half_day') AS half_days,
         SUM(attendance_status = 'absent') AS absent_days,
         SUM(attendance_status = 'leave_approved') AS leave_days,
         SUM(attendance_status = 'missing_punch') AS missing_punch,
         SUM(late_mark = 1) AS late_marks,
         COALESCE(SUM(lwp_value), 0) AS lop_days,
         COALESCE(SUM(CASE WHEN late_mark = 1 THEN late_by_minutes END), 0) AS late_minutes
    FROM attendance_daily_record
   WHERE employee_id = ? AND record_date BETWEEN ? AND ?
   GROUP BY DATE_FORMAT(record_date, '%Y-%m')
   ORDER BY month`;

const REGULARIZATION_SQL = `
  SELECT LOWER(status) AS status, COUNT(*) AS n
    FROM attendance_regularization
   WHERE employee_id = ? AND session_date BETWEEN ? AND ?
   GROUP BY LOWER(status)`;

export async function loadAttendanceSection(db: SqlExecutor, w: DossierWindow): Promise<AttendanceSection> {
  const [rows] = await db.execute<RowDataPacket[]>(ATTENDANCE_SQL, [w.employeeId, w.start, w.end]);
  const months: AttendanceMonth[] = rows.map((r) => ({
    month: String(r.month),
    workingDays: num(r.working_days),
    present: num(r.present_days),
    halfDay: num(r.half_days),
    absent: num(r.absent_days),
    leave: num(r.leave_days),
    missingPunch: num(r.missing_punch),
    lateMarks: num(r.late_marks),
    lopDays: num(r.lop_days),
    lateMinutes: num(r.late_minutes),
  }));

  const totals: AttendanceTotals = months.reduce(
    (t, m) => ({
      workingDays: t.workingDays + m.workingDays,
      present: t.present + m.present,
      halfDay: t.halfDay + m.halfDay,
      absent: t.absent + m.absent,
      leave: t.leave + m.leave,
      missingPunch: t.missingPunch + m.missingPunch,
      lateMarks: t.lateMarks + m.lateMarks,
      lopDays: t.lopDays + m.lopDays,
      lateMinutes: t.lateMinutes + m.lateMinutes,
    }),
    { workingDays: 0, present: 0, halfDay: 0, absent: 0, leave: 0, missingPunch: 0, lateMarks: 0, lopDays: 0, lateMinutes: 0 },
  );

  const attendancePct =
    totals.workingDays > 0
      ? Math.min(100, round1(((totals.present + 0.5 * totals.halfDay + totals.leave) / totals.workingDays) * 100))
      : null;

  const worst = months.reduce<AttendanceMonth | null>(
    (best, m) => (m.lateMarks > 0 && (!best || m.lateMarks > best.lateMarks) ? m : best),
    null,
  );

  const [regRows] = await db.execute<RowDataPacket[]>(REGULARIZATION_SQL, [w.employeeId, w.start, w.end]);
  const regularizations = { total: 0, approved: 0, rejected: 0, pending: 0 };
  for (const r of regRows) {
    const n = num(r.n);
    regularizations.total += n;
    const s = String(r.status);
    if (s === "approved" || s === "branch_head_approved") regularizations.approved += n;
    else if (s === "rejected") regularizations.rejected += n;
    else if (s === "pending" || s === "manager_approved") regularizations.pending += n;
  }

  return {
    months,
    totals,
    attendancePct,
    regularizations,
    late: {
      totalLateMarks: totals.lateMarks,
      avgLateMarksPerMonth: months.length ? round1(totals.lateMarks / months.length) : null,
      avgLateMinutes: totals.lateMarks > 0 ? round1(totals.lateMinutes / totals.lateMarks) : null,
      worstMonth: worst ? { month: worst.month, lateMarks: worst.lateMarks } : null,
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.attendance.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/employees/rehire/dossier
git commit -m "feat(rejoin-dossier): attendance, late coming and regularizations

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: KPI loader

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossier.kpi.ts`
- Test: `backend/src/modules/employees/rehire/dossier/__tests__/dossier.kpi.test.ts`

Achievement follows `analytics/employee-360.service.ts`: `higher_is_better` → `min(100, actual/target×100)`; `lower_is_better` → `min(100, target/actual×100)`. A month is "at target" when its average achievement across measured metrics is 100 (i.e. every measured metric hit target on average after the cap). To avoid duplicate rows from `kpi_process_config` effective dates, the loader keeps only the newest config row per (period, metric).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { achievementPct, loadKpiSection } from "../dossier.kpi.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 3);

describe("achievementPct", () => {
  it("higher is better: caps at 100", () => {
    expect(achievementPct(120, 100, "higher_is_better")).toBe(100);
    expect(achievementPct(50, 100, "higher_is_better")).toBe(50);
  });
  it("defaults to higher is better when direction is missing", () => {
    expect(achievementPct(80, 100, null)).toBe(80);
  });
  it("lower is better inverts", () => {
    expect(achievementPct(50, 100, "lower_is_better")).toBe(100);
    expect(achievementPct(200, 100, "lower_is_better")).toBe(50);
  });
  it("lower is better with zero actual is a perfect score", () => {
    expect(achievementPct(0, 100, "lower_is_better")).toBe(100);
  });
  it("returns null when there is no usable target", () => {
    expect(achievementPct(80, null, "higher_is_better")).toBeNull();
    expect(achievementPct(80, 0, "higher_is_better")).toBeNull();
  });
});

describe("loadKpiSection", () => {
  const scoreRows = [
    { period: "2026-07", metric_id: "m1", actual_value: "100", metric_name: "AHT", direction: "higher_is_better", target_value: "100", effective_from: "2026-01-01" },
    { period: "2026-07", metric_id: "m1", actual_value: "100", metric_name: "AHT", direction: "higher_is_better", target_value: "80", effective_from: "2025-01-01" }, // older config row, must be ignored
    { period: "2026-08", metric_id: "m1", actual_value: "60", metric_name: "AHT", direction: "higher_is_better", target_value: "100", effective_from: "2026-01-01" },
    { period: "2026-08", metric_id: "m2", actual_value: "100", metric_name: "QA", direction: "higher_is_better", target_value: "100", effective_from: "2026-01-01" },
    { period: "2026-09", metric_id: "m3", actual_value: "5", metric_name: "Cost", direction: "higher_is_better", target_value: null, effective_from: null },
  ];

  it("averages achievement per month and flags at-target months", async () => {
    const ex = executor({ "FROM kpi_score ks": scoreRows, "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    const jul = s.months.find((m) => m.period === "2026-07")!;
    const aug = s.months.find((m) => m.period === "2026-08")!;
    expect(jul).toMatchObject({ avgAchievementPct: 100, metricsMeasured: 1, atTarget: true });
    expect(aug).toMatchObject({ avgAchievementPct: 80, metricsMeasured: 2, atTarget: false });
  });

  it("a month with only target-less metrics has no data, not zero", async () => {
    const ex = executor({ "FROM kpi_score ks": scoreRows, "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    const sep = s.months.find((m) => m.period === "2026-09")!;
    expect(sep.avgAchievementPct).toBeNull();
    expect(sep.atTarget).toBeNull();
  });

  it("summarises months with data, months at target, share, best and worst", async () => {
    const ex = executor({ "FROM kpi_score ks": scoreRows, "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    expect(s.monthsWithData).toBe(2);
    expect(s.monthsAtTarget).toBe(1);
    expect(s.atTargetPct).toBe(50);
    expect(s.best).toEqual({ period: "2026-07", avgAchievementPct: 100 });
    expect(s.worst).toEqual({ period: "2026-08", avgAchievementPct: 80 });
  });

  it("attaches the final score and rating from the summary table when present", async () => {
    const ex = executor({
      "FROM kpi_score ks": scoreRows,
      "FROM kpi_score_summary": [{ period: "2026-07", final_score: "91.5", rating: "Exceeds", status: "locked" }],
    });
    const s = await loadKpiSection(ex as never, w);
    expect(s.months.find((m) => m.period === "2026-07")).toMatchObject({ finalScore: 91.5, rating: "Exceeds" });
  });

  it("an empty KPI history gives null percentages", async () => {
    const ex = executor({ "FROM kpi_score ks": [], "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    expect(s.monthsWithData).toBe(0);
    expect(s.atTargetPct).toBeNull();
    expect(s.best).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.kpi.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
import type { RowDataPacket } from "mysql2";
import { num, numOrNull, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface KpiMonth {
  period: string;
  avgAchievementPct: number | null;
  metricsMeasured: number;
  atTarget: boolean | null;
  finalScore: number | null;
  rating: string | null;
}

export interface KpiSection {
  months: KpiMonth[];
  monthsWithData: number;
  monthsAtTarget: number;
  atTargetPct: number | null;
  best: { period: string; avgAchievementPct: number } | null;
  worst: { period: string; avgAchievementPct: number } | null;
}

/** Same rule as analytics/employee-360.service.ts fetchKpiMetrics. */
export function achievementPct(actual: number, target: number | null, direction: string | null): number | null {
  if (target === null || !(target > 0)) return null;
  if (String(direction ?? "").toLowerCase() === "lower_is_better") {
    return actual <= 0 ? 100 : Math.min(100, (target / actual) * 100);
  }
  return Math.min(100, (actual / target) * 100);
}

// kpi_process_config can hold several effective-dated rows per (process, metric); the ORDER BY puts the
// newest first and the loop below keeps only the first row it sees per (period, metric).
const SCORE_SQL = `
  SELECT ks.period AS period, ks.metric_id AS metric_id, ks.actual_value AS actual_value,
         km.metric_name AS metric_name, km.direction AS direction,
         kpc.target_value AS target_value, kpc.effective_from AS effective_from
    FROM kpi_score ks
    JOIN kpi_metric_master km ON km.id = ks.metric_id
    LEFT JOIN employees e ON e.id = ks.employee_id
    LEFT JOIN kpi_process_config kpc ON kpc.metric_id = ks.metric_id AND kpc.process_id = e.process_id
   WHERE ks.employee_id = ? AND ks.period BETWEEN ? AND ?
   ORDER BY ks.period, ks.metric_id, kpc.effective_from DESC`;

// Optional: kpi_score_summary is empty on prod today, so it only decorates months, never defines them.
const SUMMARY_SQL = `
  SELECT DATE_FORMAT(p.period_start, '%Y-%m') AS period, s.final_score AS final_score,
         s.rating AS rating, s.status AS status
    FROM kpi_score_summary s
    JOIN kpi_score_period p ON p.id = s.period_id
   WHERE s.employee_id = ? AND p.period_start BETWEEN ? AND ?
   ORDER BY p.period_start`;

export async function loadKpiSection(db: SqlExecutor, w: DossierWindow): Promise<KpiSection> {
  const first = w.months[0]!;
  const last = w.months[w.months.length - 1]!;
  const [rows] = await db.execute<RowDataPacket[]>(SCORE_SQL, [w.employeeId, first, last]);

  const seen = new Set<string>();
  const byPeriod = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.period}|${r.metric_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pct = achievementPct(num(r.actual_value), numOrNull(r.target_value), r.direction ?? null);
    const list = byPeriod.get(String(r.period)) ?? [];
    if (pct !== null) list.push(pct);
    byPeriod.set(String(r.period), list);
  }

  const [sumRows] = await db.execute<RowDataPacket[]>(SUMMARY_SQL, [w.employeeId, w.start, w.end]);
  const summaryByPeriod = new Map<string, { finalScore: number | null; rating: string | null }>();
  for (const r of sumRows) {
    summaryByPeriod.set(String(r.period), { finalScore: numOrNull(r.final_score), rating: r.rating ?? null });
  }

  const periods = [...new Set([...byPeriod.keys(), ...summaryByPeriod.keys()])].sort();
  const months: KpiMonth[] = periods.map((period) => {
    const list = byPeriod.get(period) ?? [];
    const avg = list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null;
    const sum = summaryByPeriod.get(period);
    return {
      period,
      avgAchievementPct: avg,
      metricsMeasured: list.length,
      atTarget: avg === null ? null : avg >= 100,
      finalScore: sum?.finalScore ?? null,
      rating: sum?.rating ?? null,
    };
  });

  const measured = months.filter((m) => m.avgAchievementPct !== null);
  const atTarget = measured.filter((m) => m.atTarget).length;
  const sorted = [...measured].sort((a, b) => (b.avgAchievementPct as number) - (a.avgAchievementPct as number));
  const pick = (m: KpiMonth | undefined) =>
    m ? { period: m.period, avgAchievementPct: m.avgAchievementPct as number } : null;

  return {
    months,
    monthsWithData: measured.length,
    monthsAtTarget: atTarget,
    atTargetPct: measured.length ? round1((atTarget / measured.length) * 100) : null,
    best: pick(sorted[0]),
    worst: pick(sorted[sorted.length - 1]),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.kpi.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/employees/rehire/dossier
git commit -m "feat(rejoin-dossier): KPI by month with target achievement

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Leave and learning loaders

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossier.people.ts`
- Test: `backend/src/modules/employees/rehire/dossier/__tests__/dossier.people.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { loadLeaveSection, loadLearningSection } from "../dossier.people.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("loadLeaveSection", () => {
  const typeRows = [
    { leave_type: "Casual Leave", paid: 1, requests: "4", days: "6.0", short_notice: "3", weekend_adjacent: "2" },
    { leave_type: "Loss of Pay", paid: 0, requests: "1", days: "2.0", short_notice: "1", weekend_adjacent: "1" },
  ];

  it("totals leave and splits paid from unpaid", async () => {
    const ex = executor({ "FROM leave_request": typeRows, "FROM leave_balance_ledger": [] });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.byType).toHaveLength(2);
    expect(s.totalDays).toBe(8);
    expect(s.paidDays).toBe(6);
    expect(s.unpaidDays).toBe(2);
    expect(s.totalRequests).toBe(5);
  });

  it("reports short-notice and weekend-adjacent counts and their shares", async () => {
    const ex = executor({ "FROM leave_request": typeRows, "FROM leave_balance_ledger": [] });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.shortNoticeRequests).toBe(4);
    expect(s.weekendAdjacentRequests).toBe(3);
    expect(s.shortNoticePct).toBe(80);
    expect(s.weekendAdjacentPct).toBe(60);
  });

  it("only counts approved leave", async () => {
    const ex = executor({ "FROM leave_request": [], "FROM leave_balance_ledger": [] });
    await loadLeaveSection(ex as never, w);
    const sql = String(ex.execute.mock.calls.find(([s]) => String(s).includes("FROM leave_request"))![0]);
    expect(sql).toMatch(/status IN \('approved',\s*'branch_head_approved'\)/i);
  });

  it("picks the latest balance year per leave type", async () => {
    const ex = executor({
      "FROM leave_request": [],
      "FROM leave_balance_ledger": [
        { leave_type: "Casual Leave", balance_year: 2026, allocated_days: "12", used_days: "5", adjusted_days: "0" },
        { leave_type: "Casual Leave", balance_year: 2025, allocated_days: "12", used_days: "12", adjusted_days: "0" },
      ],
    });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.balances).toEqual([{ leaveType: "Casual Leave", year: 2026, allocated: 12, used: 5, available: 7 }]);
  });

  it("gives null shares when there is no leave", async () => {
    const ex = executor({ "FROM leave_request": [], "FROM leave_balance_ledger": [] });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.totalRequests).toBe(0);
    expect(s.shortNoticePct).toBeNull();
  });
});

describe("loadLearningSection", () => {
  it("summarises courses and lists certifications", async () => {
    const ex = executor({
      "FROM lms_learning_progress_snapshot": [
        { course_name: "Product 101", completion_pct: "100", status: "completed" },
        { course_name: "Compliance", completion_pct: "40", status: "in_progress" },
      ],
      "FROM lms_certification_snapshot": [{ certification_name: "Sales L1", issued_date: "2026-03-01", expiry_date: null, status: "active" }],
    });
    const s = await loadLearningSection(ex as never, w);
    expect(s.coursesTotal).toBe(2);
    expect(s.coursesCompleted).toBe(1);
    expect(s.avgCompletionPct).toBe(70);
    expect(s.certifications).toEqual([{ name: "Sales L1", issued: "2026-03-01", expires: null, status: "active" }]);
  });

  it("returns nulls when the employee has no LMS data", async () => {
    const ex = executor({ "FROM lms_learning_progress_snapshot": [], "FROM lms_certification_snapshot": [] });
    const s = await loadLearningSection(ex as never, w);
    expect(s.coursesTotal).toBe(0);
    expect(s.avgCompletionPct).toBeNull();
    expect(s.certifications).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.people.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
import type { RowDataPacket } from "mysql2";
import { num, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface LeaveByType {
  leaveType: string;
  paid: boolean;
  requests: number;
  days: number;
  shortNotice: number;
  weekendAdjacent: number;
}

export interface LeaveSection {
  byType: LeaveByType[];
  totalRequests: number;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  /** Heuristic: there is no planned/unplanned flag, so "short notice" = applied on or after the day before it started. */
  shortNoticeRequests: number;
  shortNoticePct: number | null;
  /** Starts on a Monday or ends on a Friday. */
  weekendAdjacentRequests: number;
  weekendAdjacentPct: number | null;
  balances: { leaveType: string; year: number; allocated: number; used: number; available: number }[];
}

const LEAVE_SQL = `
  SELECT COALESCE(lt.leave_name, lr.leave_type_code, 'Other') AS leave_type,
         COALESCE(lt.paid_leave, 1) AS paid,
         COUNT(*) AS requests,
         COALESCE(SUM(lr.total_days), 0) AS days,
         SUM(DATE(lr.applied_at) >= DATE_SUB(lr.from_date, INTERVAL 1 DAY)) AS short_notice,
         SUM(WEEKDAY(lr.from_date) = 0 OR WEEKDAY(lr.to_date) = 4) AS weekend_adjacent
    FROM leave_request lr
    LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
   WHERE lr.employee_id = ?
     AND lr.status IN ('approved', 'branch_head_approved')
     AND lr.from_date BETWEEN ? AND ?
   GROUP BY COALESCE(lt.leave_name, lr.leave_type_code, 'Other'), COALESCE(lt.paid_leave, 1)`;

// Same balance arithmetic as employees/employee.routes.ts: available = allocated + adjusted - used.
const BALANCE_SQL = `
  SELECT COALESCE(lt.leave_name, 'Other') AS leave_type, b.balance_year AS balance_year,
         b.allocated_days AS allocated_days, b.used_days AS used_days, b.adjusted_days AS adjusted_days
    FROM leave_balance_ledger b
    LEFT JOIN leave_type_master lt ON lt.id = b.leave_type_id
   WHERE b.employee_id = ?
   ORDER BY b.balance_year DESC
   LIMIT 40`;

export async function loadLeaveSection(db: SqlExecutor, w: DossierWindow): Promise<LeaveSection> {
  const [rows] = await db.execute<RowDataPacket[]>(LEAVE_SQL, [w.employeeId, w.start, w.end]);
  const byType: LeaveByType[] = rows.map((r) => ({
    leaveType: String(r.leave_type),
    paid: Number(r.paid) !== 0,
    requests: num(r.requests),
    days: num(r.days),
    shortNotice: num(r.short_notice),
    weekendAdjacent: num(r.weekend_adjacent),
  }));

  const totalRequests = byType.reduce((a, t) => a + t.requests, 0);
  const shortNoticeRequests = byType.reduce((a, t) => a + t.shortNotice, 0);
  const weekendAdjacentRequests = byType.reduce((a, t) => a + t.weekendAdjacent, 0);
  const pct = (n: number) => (totalRequests > 0 ? round1((n / totalRequests) * 100) : null);

  const [balRows] = await db.execute<RowDataPacket[]>(BALANCE_SQL, [w.employeeId]);
  const latest = new Map<string, LeaveSection["balances"][number]>();
  for (const r of balRows) {
    const type = String(r.leave_type);
    const year = num(r.balance_year);
    const existing = latest.get(type);
    if (existing && existing.year >= year) continue;
    const allocated = num(r.allocated_days);
    const used = num(r.used_days);
    latest.set(type, { leaveType: type, year, allocated, used, available: allocated + num(r.adjusted_days) - used });
  }

  return {
    byType,
    totalRequests,
    totalDays: byType.reduce((a, t) => a + t.days, 0),
    paidDays: byType.filter((t) => t.paid).reduce((a, t) => a + t.days, 0),
    unpaidDays: byType.filter((t) => !t.paid).reduce((a, t) => a + t.days, 0),
    shortNoticeRequests,
    shortNoticePct: pct(shortNoticeRequests),
    weekendAdjacentRequests,
    weekendAdjacentPct: pct(weekendAdjacentRequests),
    balances: [...latest.values()],
  };
}

export interface LearningSection {
  coursesTotal: number;
  coursesCompleted: number;
  avgCompletionPct: number | null;
  courses: { name: string; completionPct: number; status: string }[];
  certifications: { name: string; issued: string | null; expires: string | null; status: string }[];
}

// The snapshot tables already carry employees.id, so no lms_employee_mapping join is needed.
// Snapshot data covers a few hundred current employees only; an empty result is normal for a leaver.
const COURSE_SQL = `
  SELECT course_name, completion_pct, status
    FROM lms_learning_progress_snapshot
   WHERE employee_id = ?
   ORDER BY synced_at DESC
   LIMIT 50`;
const CERT_SQL = `
  SELECT certification_name,
         DATE_FORMAT(issued_date, '%Y-%m-%d') AS issued_date,
         DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
         status
    FROM lms_certification_snapshot
   WHERE employee_id = ?
   ORDER BY issued_date DESC
   LIMIT 50`;

export async function loadLearningSection(db: SqlExecutor, w: DossierWindow): Promise<LearningSection> {
  const [courseRows] = await db.execute<RowDataPacket[]>(COURSE_SQL, [w.employeeId]);
  const [certRows] = await db.execute<RowDataPacket[]>(CERT_SQL, [w.employeeId]);
  const courses = courseRows.map((r) => ({
    name: String(r.course_name),
    completionPct: num(r.completion_pct),
    status: String(r.status),
  }));
  return {
    coursesTotal: courses.length,
    coursesCompleted: courses.filter((c) => c.status === "completed").length,
    avgCompletionPct: courses.length ? round1(courses.reduce((a, c) => a + c.completionPct, 0) / courses.length) : null,
    courses,
    certifications: certRows.map((r) => ({
      name: String(r.certification_name),
      issued: r.issued_date ?? null,
      expires: r.expiry_date ?? null,
      status: String(r.status),
    })),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.people.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/employees/rehire/dossier
git commit -m "feat(rejoin-dossier): leave pattern and learning sections

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Conduct and exit-file loaders

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossier.conduct.ts`
- Create: `backend/src/modules/employees/rehire/dossier/dossier.exit.ts`
- Test: `backend/src/modules/employees/rehire/dossier/__tests__/dossier.conduct.test.ts`
- Test: `backend/src/modules/employees/rehire/dossier/__tests__/dossier.exit.test.ts`

Conduct covers everything that is evidence of behaviour: warnings (active only counted), PIPs (`active`/`extended` = open), unacknowledged performance alerts, completed coaching sessions, the HR disciplinary flag (from `employee_rehire_control`), prior absconding exits, prior rejoins and prior rejoin requests.

- [ ] **Step 1: Write the failing tests**

`__tests__/dossier.conduct.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { loadConductSection } from "../dossier.conduct.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);
const empty = {
  "FROM employee_warning": [],
  "FROM pip_record": [],
  "FROM performance_alert": [{ n: 0 }],
  "FROM coaching_session": [{ n: 0 }],
  "FROM employee_rehire_control": [],
  "abscond": [{ n: 0 }],
  "FROM employment_stint": [{ n: 0 }],
  "FROM employee_reactivation_requests": [{ n: 0 }],
};

describe("loadConductSection", () => {
  it("counts only ACTIVE warnings and flags final warnings", async () => {
    const ex = executor({
      ...empty,
      "FROM employee_warning": [
        { id: "w1", warning_date: "2026-05-01", category: "attendance", severity: "written", status: "active", description: "late" },
        { id: "w2", warning_date: "2026-06-01", category: "conduct", severity: "final", status: "active", description: "x" },
        { id: "w3", warning_date: "2026-01-01", category: "conduct", severity: "verbal", status: "withdrawn", description: "y" },
      ],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.activeWarnings).toBe(2);
    expect(s.finalWarnings).toBe(1);
    expect(s.warnings).toHaveLength(3);
  });

  it("treats active and extended PIPs as open", async () => {
    const ex = executor({
      ...empty,
      "FROM pip_record": [
        { id: "p1", start_date: "2026-02-01", end_date: "2026-04-01", status: "completed", outcome: "improved", reason: "AHT" },
        { id: "p2", start_date: "2026-06-01", end_date: null, status: "extended", outcome: null, reason: "QA" },
      ],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.openPip).toBe(true);
    expect(s.pips).toHaveLength(2);
  });

  it("no open PIP when all are closed", async () => {
    const ex = executor({
      ...empty,
      "FROM pip_record": [{ id: "p1", start_date: "2026-02-01", end_date: "2026-04-01", status: "terminated", outcome: "terminated", reason: "x" }],
    });
    expect((await loadConductSection(ex as never, w)).openPip).toBe(false);
  });

  it("reads the HR disciplinary flag from employee_rehire_control", async () => {
    const ex = executor({
      ...empty,
      "FROM employee_rehire_control": [{ disciplinary_flag: 1, disciplinary_reason: "Fraud found later", disciplinary_flag_date: "2026-09-01", block_lifted_at: null }],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.disciplinaryFlag).toEqual({ flagged: true, reason: "Fraud found later", date: "2026-09-01", lifted: false });
  });

  it("no row in employee_rehire_control means not flagged", async () => {
    const s = await loadConductSection(executor(empty) as never, w);
    expect(s.disciplinaryFlag.flagged).toBe(false);
  });

  it("reports prior absconding exits, rejoins and rejoin requests", async () => {
    const ex = executor({
      ...empty,
      "abscond": [{ n: 1 }],
      "FROM employment_stint": [{ n: 2 }],
      "FROM employee_reactivation_requests": [{ n: 3 }],
      "FROM performance_alert": [{ n: 4 }],
      "FROM coaching_session": [{ n: 5 }],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.priorAbscondingExits).toBe(1);
    expect(s.priorRejoins).toBe(2);
    expect(s.priorRejoinRequests).toBe(3);
    expect(s.unacknowledgedAlerts).toBe(4);
    expect(s.completedCoachingSessions).toBe(5);
  });
});
```

`__tests__/dossier.exit.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { loadExitSection } from "../dossier.exit.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

const exitRow = {
  id: "x1", exit_type: "voluntary", exit_sub_type: "resignation", exit_reason_category: "relocation",
  resignation_reason: "Moving cities", absconding_since: null, lwd: "2026-09-10",
  notice_period_days: 30, notice_start_date: "2026-08-20", status: "exited",
};

describe("loadExitSection", () => {
  it("returns null when the employee has never exited", async () => {
    const ex = executor({ "FROM exit_request": [] });
    expect(await loadExitSection(ex as never, w)).toBeNull();
  });

  it("assembles the exit file: reason, notice served vs required, clearance, assets, F&F", async () => {
    const ex = executor({
      "FROM exit_request": [exitRow],
      "FROM exit_clearance_checklist": [
        { department: "IT", status: "cleared", remarks: null },
        { department: "Admin", status: "pending", remarks: "laptop" },
      ],
      "FROM asset_assignment": [{ asset_name: "Laptop", asset_category: "IT", assigned_date: "2025-01-01" }],
      "FROM full_final_calculation": [{ net_payable: "18250.50", status: "paid", ff_paid_at: "2026-09-25 10:00:00" }],
    });
    const s = (await loadExitSection(ex as never, w))!;
    expect(s).toMatchObject({ exitRequestId: "x1", exitType: "voluntary", subType: "resignation", reasonCategory: "relocation", lastWorkingDay: "2026-09-10", status: "exited" });
    expect(s.notice).toEqual({ requiredDays: 30, servedDays: 21, shortfallDays: 9 });
    expect(s.clearance).toEqual({ total: 2, done: 1, pending: [{ department: "Admin", remarks: "laptop" }] });
    expect(s.assetsHeld).toEqual([{ name: "Laptop", category: "IT", assigned: "2025-01-01" }]);
    expect(s.ff).toEqual({ netPayable: 18250.5, status: "paid", paid: true });
  });

  it("an absconding exit carries the last day present", async () => {
    const ex = executor({
      "FROM exit_request": [{ ...exitRow, exit_sub_type: "absconding", exit_type: "involuntary", absconding_since: "2026-09-01", notice_start_date: null }],
      "FROM exit_clearance_checklist": [],
      "FROM asset_assignment": [],
      "FROM full_final_calculation": [],
    });
    const s = (await loadExitSection(ex as never, w))!;
    expect(s.abscondingSince).toBe("2026-09-01");
    expect(s.notice).toEqual({ requiredDays: 30, servedDays: null, shortfallDays: null });
    expect(s.ff).toBeNull();
  });

  it("never reads draft exits", async () => {
    const ex = executor({ "FROM exit_request": [] });
    await loadExitSection(ex as never, w);
    const sql = String(ex.execute.mock.calls[0]![0]);
    expect(sql).toMatch(/NOT IN \('draft'/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.conduct.test.ts src/modules/employees/rehire/dossier/__tests__/dossier.exit.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write `dossier.conduct.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import { num, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface ConductSection {
  warnings: { id: string; date: string; category: string; severity: string; status: string; description: string | null }[];
  activeWarnings: number;
  finalWarnings: number;
  pips: { id: string; start: string; end: string | null; status: string; outcome: string | null; reason: string | null }[];
  /** status active or extended (pip_record has no 'open'). */
  openPip: boolean;
  unacknowledgedAlerts: number;
  completedCoachingSessions: number;
  /** HR's flag from employee_rehire_control; a super_admin lift is shown, not hidden. */
  disciplinaryFlag: { flagged: boolean; reason: string | null; date: string | null; lifted: boolean };
  priorAbscondingExits: number;
  priorRejoins: number;
  priorRejoinRequests: number;
}

const WARNING_SQL = `
  SELECT id, DATE_FORMAT(warning_date, '%Y-%m-%d') AS warning_date, category, severity, status, description
    FROM employee_warning
   WHERE employee_id = ?
   ORDER BY warning_date DESC
   LIMIT 50`;
const PIP_SQL = `
  SELECT id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
         status, outcome, reason
    FROM pip_record
   WHERE employee_id = ?
   ORDER BY start_date DESC
   LIMIT 20`;
const ALERT_SQL = `SELECT COUNT(*) AS n FROM performance_alert WHERE employee_id = ? AND acknowledged = 0`;
const COACHING_SQL = `SELECT COUNT(*) AS n FROM coaching_session WHERE employee_id = ? AND status = 'completed'`;
const CONTROL_SQL = `
  SELECT disciplinary_flag, disciplinary_reason,
         DATE_FORMAT(disciplinary_flag_date, '%Y-%m-%d') AS disciplinary_flag_date, block_lifted_at
    FROM employee_rehire_control
   WHERE employee_id = ?`;
const ABSCOND_SQL = `
  SELECT COUNT(*) AS n FROM exit_request
   WHERE employee_id = ?
     AND (LOWER(exit_sub_type) IN ('absconding','abandonment') OR LOWER(exit_reason_category) = 'absconding')`;
const STINT_SQL = `SELECT COUNT(*) AS n FROM employment_stint WHERE employee_id = ? AND stint_no > 1`;
const REQUEST_SQL = `SELECT COUNT(*) AS n FROM employee_reactivation_requests WHERE employee_id = ? AND status = 'approved'`;

export async function loadConductSection(db: SqlExecutor, w: DossierWindow): Promise<ConductSection> {
  const id = [w.employeeId];
  const [warnRows] = await db.execute<RowDataPacket[]>(WARNING_SQL, id);
  const [pipRows] = await db.execute<RowDataPacket[]>(PIP_SQL, id);
  const [alertRows] = await db.execute<RowDataPacket[]>(ALERT_SQL, id);
  const [coachRows] = await db.execute<RowDataPacket[]>(COACHING_SQL, id);
  const [ctlRows] = await db.execute<RowDataPacket[]>(CONTROL_SQL, id);
  const [abscondRows] = await db.execute<RowDataPacket[]>(ABSCOND_SQL, id);
  const [stintRows] = await db.execute<RowDataPacket[]>(STINT_SQL, id);
  const [reqRows] = await db.execute<RowDataPacket[]>(REQUEST_SQL, id);

  const warnings = warnRows.map((r) => ({
    id: String(r.id),
    date: String(r.warning_date),
    category: String(r.category),
    severity: String(r.severity),
    status: String(r.status),
    description: r.description ?? null,
  }));
  const active = warnings.filter((x) => x.status === "active");
  const pips = pipRows.map((r) => ({
    id: String(r.id),
    start: String(r.start_date),
    end: r.end_date ?? null,
    status: String(r.status),
    outcome: r.outcome ?? null,
    reason: r.reason ?? null,
  }));
  const ctl = ctlRows[0];

  return {
    warnings,
    activeWarnings: active.length,
    finalWarnings: active.filter((x) => x.severity === "final").length,
    pips,
    openPip: pips.some((p) => p.status === "active" || p.status === "extended"),
    unacknowledgedAlerts: num(alertRows[0]?.n),
    completedCoachingSessions: num(coachRows[0]?.n),
    disciplinaryFlag: {
      flagged: Number(ctl?.disciplinary_flag) === 1,
      reason: ctl?.disciplinary_reason ?? null,
      date: ctl?.disciplinary_flag_date ?? null,
      lifted: ctl?.block_lifted_at != null,
    },
    priorAbscondingExits: num(abscondRows[0]?.n),
    priorRejoins: num(stintRows[0]?.n),
    priorRejoinRequests: num(reqRows[0]?.n),
  };
}
```

- [ ] **Step 4: Write `dossier.exit.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import { daysBetween } from "../rehireFacts.js";
import { num, numOrNull, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface ExitSection {
  exitRequestId: string;
  exitType: string | null;
  subType: string | null;
  reasonCategory: string | null;
  reasonText: string | null;
  /** Last day the employee was actually present, for absconding / abandonment. */
  abscondingSince: string | null;
  lastWorkingDay: string | null;
  status: string;
  notice: { requiredDays: number | null; servedDays: number | null; shortfallDays: number | null };
  clearance: { total: number; done: number; pending: { department: string; remarks: string | null }[] };
  assetsHeld: { name: string; category: string | null; assigned: string | null }[];
  ff: { netPayable: number | null; status: string; paid: boolean } | null;
}

// Latest real exit. Drafts are not exits. A 'rejoined' exit is still shown: it is the history the
// branch head is judging, and it is what the open request refers to until approval.
const EXIT_SQL = `
  SELECT id, exit_type, exit_sub_type, exit_reason_category, resignation_reason,
         DATE_FORMAT(absconding_since, '%Y-%m-%d') AS absconding_since,
         DATE_FORMAT(COALESCE(last_working_day_confirmed, last_working_day_proposed), '%Y-%m-%d') AS lwd,
         notice_period_days, DATE_FORMAT(notice_start_date, '%Y-%m-%d') AS notice_start_date, status
    FROM exit_request
   WHERE employee_id = ? AND LOWER(status) NOT IN ('draft')
   ORDER BY created_at DESC
   LIMIT 1`;
const CLEARANCE_SQL = `
  SELECT department, status, remarks FROM exit_clearance_checklist WHERE exit_request_id = ? ORDER BY department`;
const ASSET_SQL = `
  SELECT am.asset_name AS asset_name, am.asset_category AS asset_category,
         DATE_FORMAT(aa.assigned_date, '%Y-%m-%d') AS assigned_date
    FROM asset_assignment aa
    JOIN asset_master am ON am.id = aa.asset_id
   WHERE aa.employee_id = ? AND aa.returned_date IS NULL`;
const FF_SQL = `
  SELECT net_payable, status, ff_paid_at FROM full_final_calculation
   WHERE exit_request_id = ? ORDER BY created_at DESC LIMIT 1`;

export async function loadExitSection(db: SqlExecutor, w: DossierWindow): Promise<ExitSection | null> {
  const [exitRows] = await db.execute<RowDataPacket[]>(EXIT_SQL, [w.employeeId]);
  const x = exitRows[0];
  if (!x) return null;

  const [clearRows] = await db.execute<RowDataPacket[]>(CLEARANCE_SQL, [x.id]);
  const [assetRows] = await db.execute<RowDataPacket[]>(ASSET_SQL, [w.employeeId]);
  const [ffRows] = await db.execute<RowDataPacket[]>(FF_SQL, [x.id]);

  const required = numOrNull(x.notice_period_days);
  const served = x.notice_start_date && x.lwd ? Math.max(0, daysBetween(x.notice_start_date, x.lwd)) : null;
  const shortfall = required !== null && served !== null ? Math.max(0, required - served) : null;

  const isDone = (s: unknown) => ["cleared", "waived"].includes(String(s).toLowerCase());
  const ff = ffRows[0];

  return {
    exitRequestId: String(x.id),
    exitType: x.exit_type ?? null,
    subType: x.exit_sub_type ?? null,
    reasonCategory: x.exit_reason_category ?? null,
    reasonText: x.resignation_reason ?? null,
    abscondingSince: x.absconding_since ?? null,
    lastWorkingDay: x.lwd ?? null,
    status: String(x.status),
    notice: { requiredDays: required, servedDays: served, shortfallDays: shortfall },
    clearance: {
      total: clearRows.length,
      done: clearRows.filter((r) => isDone(r.status)).length,
      pending: clearRows
        .filter((r) => !isDone(r.status) && String(r.status).toLowerCase() !== "superseded")
        .map((r) => ({ department: String(r.department), remarks: r.remarks ?? null })),
    },
    assetsHeld: assetRows.map((r) => ({
      name: String(r.asset_name),
      category: r.asset_category ?? null,
      assigned: r.assigned_date ?? null,
    })),
    ff: ff ? { netPayable: numOrNull(ff.net_payable), status: String(ff.status), paid: ff.ff_paid_at != null } : null,
  };
}
```

`num` is imported in the exit loader only if used; if the linter flags it as unused, drop it from the import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.conduct.test.ts src/modules/employees/rehire/dossier/__tests__/dossier.exit.test.ts`
Expected: PASS (6 + 4 tests). Check carefully: the conduct test's `"abscond"` mock key must match only the absconding-count query. The other conduct SQL strings contain no "abscond".

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/employees/rehire/dossier
git commit -m "feat(rejoin-dossier): conduct and exit-file sections

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Header, payroll footprint and timeline

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossier.header.ts`
- Create: `backend/src/modules/employees/rehire/dossier/dossier.payroll.ts`
- Create: `backend/src/modules/employees/rehire/dossier/dossier.timeline.ts`
- Test: `dossier/__tests__/dossier.header.test.ts`, `dossier.payroll.test.ts`, `dossier.timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

`dossier.header.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { loadHeaderSection, tenureMonths } from "../dossier.header.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("tenureMonths", () => {
  it("counts whole months between two dates", () => {
    expect(tenureMonths("2025-07-15", "2026-09-10")).toBe(13);
    expect(tenureMonths("2026-09-01", "2026-09-10")).toBe(0);
    expect(tenureMonths("2025-09-10", "2026-09-10")).toBe(12);
  });
  it("is null with a missing date and never negative", () => {
    expect(tenureMonths(null, "2026-09-10")).toBeNull();
    expect(tenureMonths("2027-01-01", "2026-09-10")).toBe(0);
  });
});

describe("loadHeaderSection", () => {
  const row = {
    id: "e1", employee_code: "MAS001", full_name: "Asha Rao", photo_url: "/p.png", designation_name: "Agent",
    dept_name: "Ops", branch_name: "Pune", process_name: "SBI Cards", manager_name: "Ravi K", manager_code: "MAS009",
    date_of_joining: "2025-07-15", date_of_exit: "2026-09-10", employment_status: "Resigned",
  };

  it("returns the header with tenure measured to the as-of date", async () => {
    const ex = executor({ "FROM employees e": [row], "FROM employment_stint": [] });
    const h = (await loadHeaderSection(ex as never, w))!;
    expect(h).toMatchObject({ employeeId: "e1", employeeCode: "MAS001", name: "Asha Rao", branch: "Pune", process: "SBI Cards", designation: "Agent", manager: "Ravi K (MAS009)" });
    expect(h.tenureMonths).toBe(13);
    expect(h.dateOfJoining).toBe("2025-07-15");
  });

  it("measures tenure from the FIRST stint when the employee has rejoined before", async () => {
    const ex = executor({ "FROM employees e": [row], "FROM employment_stint": [{ start_date: "2024-01-01" }] });
    const h = (await loadHeaderSection(ex as never, w))!;
    expect(h.tenureMonths).toBe(32);
  });

  it("returns null for an unknown employee", async () => {
    expect(await loadHeaderSection(executor({}) as never, w)).toBeNull();
  });
});
```

`dossier.payroll.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { loadPayrollSection } from "../dossier.payroll.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("loadPayrollSection", () => {
  const slips = [
    { run_month: "2026-08", gross_salary: "22000", net_salary: "19000", total_deductions: "3000" },
    { run_month: "2026-07", gross_salary: "22000", net_salary: "18000", total_deductions: "4000" },
  ];

  it("summarises recent payslips: last net, average net", async () => {
    const ex = executor({
      "FROM salary_prep_line": slips,
      "FROM employee_salary_history": [{ gross: "22000", ctc: "300000" }],
      "FROM employee_loans": [{ total: "0" }],
      "FROM salary_advance_log": [{ total: "0" }],
      "FROM employee_deduction_entries": [{ total: "0" }],
    });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.payslips).toHaveLength(2);
    expect(s.lastNet).toBe(19000);
    expect(s.avgNet).toBe(18500);
    expect(s.currentSalary).toEqual({ gross: 22000, ctc: 300000 });
  });

  it("only reads final payroll runs, never drafts", async () => {
    const ex = executor({ "FROM salary_prep_line": [] });
    await loadPayrollSection(ex as never, w);
    const sql = String(ex.execute.mock.calls.find(([s]) => String(s).includes("FROM salary_prep_line"))![0]);
    expect(sql).toMatch(/IN \('locked',\s*'finalized',\s*'approved',\s*'disbursed',\s*'completed'\)/i);
  });

  it("sums pending recoveries across loans, advances and deductions", async () => {
    const ex = executor({
      "FROM salary_prep_line": [],
      "FROM employee_loans": [{ total: "5000" }],
      "FROM salary_advance_log": [{ total: "1500" }],
      "FROM employee_deduction_entries": [{ total: "500" }],
    });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.pendingRecoveries).toEqual({ loans: 5000, advances: 1500, deductions: 500, total: 7000 });
  });

  it("a failing recovery table degrades to null recoveries instead of failing the section", async () => {
    const ex = executor({
      "FROM salary_prep_line": slips,
      "FROM employee_loans": new Error("Unknown column"),
    });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.lastNet).toBe(19000);
    expect(s.pendingRecoveries).toBeNull();
  });

  it("nulls when there are no payslips", async () => {
    const ex = executor({ "FROM salary_prep_line": [] });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.lastNet).toBeNull();
    expect(s.avgNet).toBeNull();
  });
});
```

`dossier.timeline.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildTimeline, loadTimelineSection, type TimelineEvent } from "../dossier.timeline.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("buildTimeline", () => {
  it("sorts newest first and drops events without a date", () => {
    const events: TimelineEvent[] = [
      { date: "2026-01-01", kind: "joining", title: "Joined", detail: null },
      { date: "2026-06-01", kind: "promotion", title: "Promoted", detail: null },
      { date: "", kind: "other", title: "No date", detail: null },
    ];
    expect(buildTimeline(events).map((e) => e.title)).toEqual(["Promoted", "Joined"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, kind: "x", title: `e${i}`, detail: null }));
    expect(buildTimeline(many, 100)).toHaveLength(100);
  });
});

describe("loadTimelineSection", () => {
  it("merges history tables and lifecycle events into one list", async () => {
    const ex = executor({
      "FROM employee_journey_log": [{ event_date: "2025-07-15", event_type: "joined", description: "Joined as Agent" }],
      "FROM employee_job_history": [{ effective_date: "2026-01-01", change_type: "designation", reason: "Annual review" }],
      "FROM promotion_record": [],
      "FROM transfer_record": [{ effective_date: "2026-03-01", transfer_type: "process", from_value: "A", to_value: "B", status: "completed" }],
      "FROM employee_warning": [{ warning_date: "2026-05-01", severity: "written", category: "attendance" }],
      "FROM exit_request": [{ event_date: "2026-09-10", exit_sub_type: "resignation", status: "exited" }],
      "FROM employee_reactivation_requests": [{ event_date: "2026-09-25", status: "pending" }],
    });
    const t = await loadTimelineSection(ex as never, w);
    expect(t.events.map((e) => e.kind)).toEqual(["rejoin_request", "exit", "warning", "transfer", "job_change", "joining"]);
    expect(t.events[0]!.date).toBe("2026-09-25");
    expect(t.skipped).toEqual([]);
  });

  it("skips a source whose query fails and reports it, keeping the rest", async () => {
    const ex = executor({
      "FROM employee_journey_log": [{ event_date: "2025-07-15", event_type: "joined", description: "Joined" }],
      "FROM promotion_record": new Error("Unknown column 'status'"),
    });
    const t = await loadTimelineSection(ex as never, w);
    expect(t.events).toHaveLength(1);
    expect(t.skipped).toEqual(["promotion_record"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.header.test.ts src/modules/employees/rehire/dossier/__tests__/dossier.payroll.test.ts src/modules/employees/rehire/dossier/__tests__/dossier.timeline.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write `dossier.header.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import { type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface HeaderSection {
  employeeId: string;
  employeeCode: string;
  name: string;
  photoUrl: string | null;
  designation: string | null;
  department: string | null;
  branch: string | null;
  process: string | null;
  manager: string | null;
  dateOfJoining: string | null;
  dateOfExit: string | null;
  employmentStatus: string | null;
  /** Whole months from the first joining (or first stint) to the as-of date. */
  tenureMonths: number | null;
}

/** Whole months, pure string math. Never negative. */
export function tenureMonths(from: string | null, to: string): number | null {
  if (!from) return null;
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

// Display joins follow analytics/employee-360.service.ts: branch_master, process_master, designation_master,
// department_master. (Tables named branches/departments/designations do not exist.)
const HEADER_SQL = `
  SELECT e.id AS id, e.employee_code AS employee_code,
         COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', e.last_name)) AS full_name,
         e.photo_url AS photo_url, d.designation_name AS designation_name, dm.dept_name AS dept_name,
         b.branch_name AS branch_name, p.process_name AS process_name,
         CONCAT(mgr.first_name, ' ', mgr.last_name) AS manager_name, mgr.employee_code AS manager_code,
         DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining,
         DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS date_of_exit,
         e.employment_status AS employment_status
    FROM employees e
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN designation_master d ON d.id = e.designation_id
    LEFT JOIN department_master dm ON dm.id = e.department_id
    LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
   WHERE e.id = ?`;

const FIRST_STINT_SQL = `SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM employment_stint WHERE employee_id = ? AND stint_no = 1`;

export async function loadHeaderSection(db: SqlExecutor, w: DossierWindow): Promise<HeaderSection | null> {
  const [rows] = await db.execute<RowDataPacket[]>(HEADER_SQL, [w.employeeId]);
  const r = rows[0];
  if (!r) return null;
  const [stintRows] = await db.execute<RowDataPacket[]>(FIRST_STINT_SQL, [w.employeeId]);
  const since: string | null = stintRows[0]?.start_date ?? r.date_of_joining ?? null;

  return {
    employeeId: String(r.id),
    employeeCode: String(r.employee_code),
    name: String(r.full_name ?? "").trim(),
    photoUrl: r.photo_url ?? null,
    designation: r.designation_name ?? null,
    department: r.dept_name ?? null,
    branch: r.branch_name ?? null,
    process: r.process_name ?? null,
    manager: r.manager_name ? `${String(r.manager_name).trim()}${r.manager_code ? ` (${r.manager_code})` : ""}` : null,
    dateOfJoining: r.date_of_joining ?? null,
    dateOfExit: r.date_of_exit ?? null,
    employmentStatus: r.employment_status ?? null,
    tenureMonths: tenureMonths(since, w.end),
  };
}
```

- [ ] **Step 4: Write `dossier.payroll.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import { num, numOrNull, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface PayrollSection {
  payslips: { month: string; gross: number; net: number; deductions: number }[];
  lastNet: number | null;
  avgNet: number | null;
  currentSalary: { gross: number | null; ctc: number | null } | null;
  /** null when a recovery table could not be read; the page shows "unavailable", not zero. */
  pendingRecoveries: { loans: number; advances: number; deductions: number; total: number } | null;
}

// Only final runs, same visibility rule as dashboards/role-insights/providers/employeeCalc.ts. Drafts are not pay.
const SLIP_SQL = `
  SELECT spr.run_month AS run_month, spl.gross_salary AS gross_salary, spl.net_salary AS net_salary,
         spl.total_deductions AS total_deductions
    FROM salary_prep_line spl
    JOIN salary_prep_run spr ON spr.id = spl.run_id
   WHERE spl.employee_id = ?
     AND LOWER(spr.status) IN ('locked', 'finalized', 'approved', 'disbursed', 'completed')
     AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')
   ORDER BY spr.run_month DESC
   LIMIT 12`;
const SALARY_SQL = `SELECT gross, ctc FROM employee_salary_history WHERE employee_id = ? AND is_current = 1 LIMIT 1`;
const LOAN_SQL = `SELECT COALESCE(SUM(pending_amount), 0) AS total FROM employee_loans WHERE employee_id = ? AND status = 'active'`;
const ADVANCE_SQL = `SELECT COALESCE(SUM(amount - COALESCE(recovered_amount, 0)), 0) AS total FROM salary_advance_log WHERE employee_id = ? AND amount - COALESCE(recovered_amount, 0) > 0`;
const DEDUCTION_SQL = `SELECT COALESCE(SUM(amount), 0) AS total FROM employee_deduction_entries WHERE employee_id = ? AND status IN ('active', 'pending_approval')`;

export async function loadPayrollSection(db: SqlExecutor, w: DossierWindow): Promise<PayrollSection> {
  const [slipRows] = await db.execute<RowDataPacket[]>(SLIP_SQL, [w.employeeId]);
  const payslips = slipRows.map((r) => ({
    month: String(r.run_month),
    gross: num(r.gross_salary),
    net: num(r.net_salary),
    deductions: num(r.total_deductions),
  }));

  let currentSalary: PayrollSection["currentSalary"] = null;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(SALARY_SQL, [w.employeeId]);
    if (rows[0]) currentSalary = { gross: numOrNull(rows[0].gross), ctc: numOrNull(rows[0].ctc) };
  } catch {
    currentSalary = null;
  }

  // Three independent tables, read as one unit: a wrong column in any of them means "unavailable", not a partial total.
  let pendingRecoveries: PayrollSection["pendingRecoveries"] = null;
  try {
    const [loan] = await db.execute<RowDataPacket[]>(LOAN_SQL, [w.employeeId]);
    const [adv] = await db.execute<RowDataPacket[]>(ADVANCE_SQL, [w.employeeId]);
    const [ded] = await db.execute<RowDataPacket[]>(DEDUCTION_SQL, [w.employeeId]);
    const loans = num(loan[0]?.total);
    const advances = num(adv[0]?.total);
    const deductions = num(ded[0]?.total);
    pendingRecoveries = { loans, advances, deductions, total: loans + advances + deductions };
  } catch {
    pendingRecoveries = null;
  }

  return {
    payslips,
    lastNet: payslips[0]?.net ?? null,
    avgNet: payslips.length ? round1(payslips.reduce((a, p) => a + p.net, 0) / payslips.length) : null,
    currentSalary,
    pendingRecoveries,
  };
}
```

- [ ] **Step 5: Write `dossier.timeline.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import { type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface TimelineEvent {
  /** 'YYYY-MM-DD' */
  date: string;
  kind: string;
  title: string;
  detail: string | null;
}

export interface TimelineSection {
  events: TimelineEvent[];
  /** Sources whose query failed and were left out, so the page can say the timeline is incomplete. */
  skipped: string[];
}

export function buildTimeline(events: TimelineEvent[], limit = 100): TimelineEvent[] {
  return events
    .filter((e) => e.date && e.date.length >= 10)
    .map((e) => ({ ...e, date: e.date.slice(0, 10) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

interface Source {
  table: string;
  sql: string;
  map: (r: RowDataPacket) => TimelineEvent;
}

const fmt = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;

// Several of these tables were read from SQL files, not a live database, so each source is isolated: a wrong
// column drops that one source (reported in `skipped`) and never the page.
const SOURCES: Source[] = [
  {
    table: "employee_journey_log",
    sql: `SELECT ${fmt("event_date")} AS event_date, event_type, description FROM employee_journey_log WHERE employee_id = ? ORDER BY event_date DESC LIMIT 60`,
    map: (r) => ({ date: String(r.event_date ?? ""), kind: "joining", title: String(r.description ?? r.event_type ?? "Event"), detail: r.event_type ?? null }),
  },
  {
    table: "employee_job_history",
    sql: `SELECT ${fmt("effective_date")} AS effective_date, change_type, reason FROM employee_job_history WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 40`,
    map: (r) => ({ date: String(r.effective_date ?? ""), kind: "job_change", title: `Job change: ${r.change_type ?? "update"}`, detail: r.reason ?? null }),
  },
  {
    table: "promotion_record",
    sql: `SELECT ${fmt("effective_date")} AS effective_date, status FROM promotion_record WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 20`,
    map: (r) => ({ date: String(r.effective_date ?? ""), kind: "promotion", title: "Promotion", detail: r.status ?? null }),
  },
  {
    table: "transfer_record",
    sql: `SELECT ${fmt("effective_date")} AS effective_date, transfer_type, from_value, to_value, status FROM transfer_record WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 20`,
    map: (r) => ({ date: String(r.effective_date ?? ""), kind: "transfer", title: `Transfer (${r.transfer_type ?? "n/a"}): ${r.from_value ?? "?"} → ${r.to_value ?? "?"}`, detail: r.status ?? null }),
  },
  {
    table: "employee_warning",
    sql: `SELECT ${fmt("warning_date")} AS warning_date, severity, category FROM employee_warning WHERE employee_id = ? ORDER BY warning_date DESC LIMIT 20`,
    map: (r) => ({ date: String(r.warning_date ?? ""), kind: "warning", title: `${r.severity ?? ""} warning`.trim(), detail: r.category ?? null }),
  },
  {
    table: "exit_request",
    sql: `SELECT ${fmt("COALESCE(last_working_day_confirmed, last_working_day_proposed, created_at)")} AS event_date, exit_sub_type, status FROM exit_request WHERE employee_id = ? AND LOWER(status) NOT IN ('draft') ORDER BY created_at DESC LIMIT 10`,
    map: (r) => ({ date: String(r.event_date ?? ""), kind: "exit", title: `Exit: ${r.exit_sub_type ?? "n/a"}`, detail: r.status ?? null }),
  },
  {
    table: "employee_reactivation_requests",
    sql: `SELECT ${fmt("created_at")} AS event_date, status FROM employee_reactivation_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`,
    map: (r) => ({ date: String(r.event_date ?? ""), kind: "rejoin_request", title: "Rejoin request raised", detail: r.status ?? null }),
  },
];

export async function loadTimelineSection(db: SqlExecutor, w: DossierWindow): Promise<TimelineSection> {
  const events: TimelineEvent[] = [];
  const skipped: string[] = [];
  for (const s of SOURCES) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(s.sql, [w.employeeId]);
      for (const r of rows) events.push(s.map(r));
    } catch {
      skipped.push(s.table);
    }
  }
  return { events: buildTimeline(events), skipped };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossier.header.test.ts src/modules/employees/rehire/dossier/__tests__/dossier.payroll.test.ts src/modules/employees/rehire/dossier/__tests__/dossier.timeline.test.ts`
Expected: PASS (5 + 5 + 4 tests). Watch the header mock key `"FROM employees e"`: it must match the header query and not `FIRST_STINT_SQL`; the timeline mock key `"FROM exit_request"` must match only the exit source. If a key collision breaks a test, change the SQL whitespace, not the key.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/employees/rehire/dossier
git commit -m "feat(rejoin-dossier): header, payroll footprint and timeline

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Aggregator, route, mount

**Files:**
- Create: `backend/src/modules/employees/rehire/dossier/dossierService.ts`
- Create: `backend/src/modules/employees/rejoin-dossier.routes.ts`
- Modify: `backend/src/app.ts` (import + one `app.use` line next to the reactivation router, ~line 653)
- Test: `dossier/__tests__/dossierService.test.ts`, `backend/src/modules/employees/rehire/__tests__/rejoinDossierRoutes.test.ts`

Response shape (frozen here so Plan 2b can code against it):

```ts
interface Dossier {
  request: { id: string; employeeId: string; status: string; proposedJoiningDate: string; reason: string; raisedByRole: string | null; gapDays: number };
  window: { start: string; end: string; months: string[] };
  eligibility: RehireVerdict;            // evaluated fresh, not the stored snapshot
  verdict: DossierVerdict;               // advisory rating + reasons
  sections: {
    header: SectionResult<HeaderSection | null>;
    attendance: SectionResult<AttendanceSection>;
    kpi: SectionResult<KpiSection>;
    leave: SectionResult<LeaveSection>;
    learning: SectionResult<LearningSection>;
    conduct: SectionResult<ConductSection>;
    exit: SectionResult<ExitSection | null>;
    payroll: SectionResult<PayrollSection>;
    timeline: SectionResult<TimelineSection>;
  };
  generatedAt: string;
}
```

(Late coming lives inside `attendance.late`.)

- [ ] **Step 1: Write the failing service test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  loadRehireFacts: vi.fn(),
  header: vi.fn(), attendance: vi.fn(), kpi: vi.fn(), leave: vi.fn(), learning: vi.fn(),
  conduct: vi.fn(), exit: vi.fn(), payroll: vi.fn(), timeline: vi.fn(),
}));
vi.mock("../../rehireFacts.js", async (orig) => ({ ...(await orig<typeof import("../../rehireFacts.js")>()), loadRehireFacts: m.loadRehireFacts }));
vi.mock("../dossier.header.js", () => ({ loadHeaderSection: m.header }));
vi.mock("../dossier.attendance.js", () => ({ loadAttendanceSection: m.attendance }));
vi.mock("../dossier.kpi.js", () => ({ loadKpiSection: m.kpi }));
vi.mock("../dossier.people.js", () => ({ loadLeaveSection: m.leave, loadLearningSection: m.learning }));
vi.mock("../dossier.conduct.js", () => ({ loadConductSection: m.conduct }));
vi.mock("../dossier.exit.js", () => ({ loadExitSection: m.exit }));
vi.mock("../dossier.payroll.js", () => ({ loadPayrollSection: m.payroll }));
vi.mock("../dossier.timeline.js", () => ({ loadTimelineSection: m.timeline }));

const { buildDossier } = await import("../dossierService.js");

const requestRow = {
  id: "r1", employee_id: "e1", status: "pending", proposed_joining_date: "2026-09-20",
  reinstatement_reason: "Good record", raised_by_role: "hr", gap_days: 10,
};
const facts = {
  exitRequestId: "x1", previousEndDate: "2026-09-10", ffAlreadyPaid: false,
  facts: { hasExitRecord: true, exitType: "voluntary", exitSubType: "resignation", exitReasonCategory: "relocation", legacyStatusText: "Resigned",
    disciplinaryFlag: false, blockLifted: false, gapDays: 10, priorRejoinCount: 0, totalAbscondingExits: 0,
    openClearanceCase: false, assetsUnreturned: false, ffAlreadyPaid: false },
};
const attendance = { months: [], totals: {}, attendancePct: 96, regularizations: { total: 0, approved: 0, rejected: 0, pending: 0 }, late: { totalLateMarks: 2, avgLateMarksPerMonth: 1, avgLateMinutes: 10, worstMonth: null } };
const kpi = { months: [], monthsWithData: 10, monthsAtTarget: 9, atTargetPct: 90, best: null, worst: null };
const conduct = { warnings: [], activeWarnings: 0, finalWarnings: 0, pips: [], openPip: false, unacknowledgedAlerts: 0, completedCoachingSessions: 0, disciplinaryFlag: { flagged: false, reason: null, date: null, lifted: false }, priorAbscondingExits: 0, priorRejoins: 0, priorRejoinRequests: 0 };

function db(rows: unknown[] = [requestRow]) {
  return { execute: vi.fn(async () => [rows, []]) };
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.loadRehireFacts.mockResolvedValue(facts);
  m.header.mockResolvedValue({ tenureMonths: 14 });
  m.attendance.mockResolvedValue(attendance);
  m.kpi.mockResolvedValue(kpi);
  m.leave.mockResolvedValue({});
  m.learning.mockResolvedValue({});
  m.conduct.mockResolvedValue(conduct);
  m.exit.mockResolvedValue(null);
  m.payroll.mockResolvedValue({});
  m.timeline.mockResolvedValue({ events: [], skipped: [] });
});

describe("buildDossier", () => {
  it("returns null for an unknown request", async () => {
    expect(await buildDossier(db([]) as never, "nope")).toBeNull();
  });

  it("assembles every section, the fresh eligibility, and a verdict", async () => {
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.request).toMatchObject({ id: "r1", employeeId: "e1", status: "pending", raisedByRole: "hr", gapDays: 10 });
    expect(d.eligibility.status).toBe("eligible");
    expect(d.verdict.rating).toBe("strong");
    expect(Object.keys(d.sections).sort()).toEqual(["attendance", "conduct", "exit", "header", "kpi", "leave", "learning", "payroll", "timeline"]);
    expect(d.sections.attendance).toEqual({ status: "ok", data: attendance });
  });

  it("uses the last day of the previous stint as the end of the window", async () => {
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.window.end).toBe("2026-09-10");
    expect(d.window.months).toHaveLength(12);
    expect(m.attendance.mock.calls[0]![1].end).toBe("2026-09-10");
  });

  it("isolates a failing section: it reports an error, the others still load", async () => {
    m.kpi.mockRejectedValue(new Error("kpi down"));
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.sections.kpi).toEqual({ status: "error", error: "kpi down" });
    expect(d.sections.attendance.status).toBe("ok");
    expect(d.verdict.rating).toBeDefined();
  });

  it("evaluates eligibility fresh: a blocked employee shows blocked even if the request was raised earlier", async () => {
    m.loadRehireFacts.mockResolvedValue({ ...facts, facts: { ...facts.facts, exitSubType: "termination" } });
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.eligibility.status).toBe("blocked");
  });

  it("feeds conduct into the verdict: a final warning makes it weak", async () => {
    m.conduct.mockResolvedValue({ ...conduct, activeWarnings: 1, finalWarnings: 1 });
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.verdict.rating).toBe("weak");
  });

  it("falls back to today when there is no previous end date", async () => {
    m.loadRehireFacts.mockResolvedValue({ ...facts, previousEndDate: null });
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.window.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("still returns a dossier when facts cannot be loaded, with no eligibility claim made up", async () => {
    m.loadRehireFacts.mockResolvedValue(null);
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.eligibility.status).toBe("blocked");
    expect(d.eligibility.reasons[0]!.code).toBe("EMPLOYEE_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossierService.test.ts`
Expected: FAIL — `../dossierService.js` missing.

- [ ] **Step 3: Write `dossierService.ts`**

```ts
import type { RowDataPacket } from "mysql2";
import { evaluateRehire, type RehireVerdict } from "../rehireEligibility.js";
import { loadRehireFacts } from "../rehireFacts.js";
import { loadAttendanceSection } from "./dossier.attendance.js";
import { loadConductSection } from "./dossier.conduct.js";
import { loadExitSection } from "./dossier.exit.js";
import { loadHeaderSection } from "./dossier.header.js";
import { loadKpiSection } from "./dossier.kpi.js";
import { loadLeaveSection, loadLearningSection } from "./dossier.people.js";
import { loadPayrollSection } from "./dossier.payroll.js";
import { loadTimelineSection } from "./dossier.timeline.js";
import { buildVerdict, type DossierVerdict } from "./dossierVerdict.js";
import { buildWindow, settle, type SectionResult, type SqlExecutor } from "./dossierTypes.js";

import type { AttendanceSection } from "./dossier.attendance.js";
import type { ConductSection } from "./dossier.conduct.js";
import type { ExitSection } from "./dossier.exit.js";
import type { HeaderSection } from "./dossier.header.js";
import type { KpiSection } from "./dossier.kpi.js";
import type { LeaveSection, LearningSection } from "./dossier.people.js";
import type { PayrollSection } from "./dossier.payroll.js";
import type { TimelineSection } from "./dossier.timeline.js";

export interface Dossier {
  request: {
    id: string;
    employeeId: string;
    status: string;
    proposedJoiningDate: string;
    reason: string;
    raisedByRole: string | null;
    gapDays: number;
  };
  window: { start: string; end: string; months: string[] };
  /** Evaluated fresh from live facts, not the snapshot stored when the request was raised. */
  eligibility: RehireVerdict;
  /** Advisory only. */
  verdict: DossierVerdict;
  sections: {
    header: SectionResult<HeaderSection | null>;
    attendance: SectionResult<AttendanceSection>;
    kpi: SectionResult<KpiSection>;
    leave: SectionResult<LeaveSection>;
    learning: SectionResult<LearningSection>;
    conduct: SectionResult<ConductSection>;
    exit: SectionResult<ExitSection | null>;
    payroll: SectionResult<PayrollSection>;
    timeline: SectionResult<TimelineSection>;
  };
  generatedAt: string;
}

const REQUEST_SQL = `
  SELECT id, employee_id, status, DATE_FORMAT(proposed_joining_date, '%Y-%m-%d') AS proposed_joining_date,
         reinstatement_reason, raised_by_role, gap_days
    FROM employee_reactivation_requests
   WHERE id = ?`;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const UNKNOWN_EMPLOYEE: RehireVerdict = {
  status: "blocked",
  reasons: [{ code: "EMPLOYEE_NOT_FOUND", severity: "blocked", message: "The employee record could not be loaded." }],
  requiresFreshOnboarding: false,
  requiresAbscondingAck: false,
};

export async function buildDossier(db: SqlExecutor, requestId: string): Promise<Dossier | null> {
  const [reqRows] = await db.execute<RowDataPacket[]>(REQUEST_SQL, [requestId]);
  const req = reqRows[0];
  if (!req) return null;
  const employeeId = String(req.employee_id);

  const loaded = await loadRehireFacts(db, employeeId, String(req.proposed_joining_date));
  const eligibility = loaded ? evaluateRehire(loaded.facts) : UNKNOWN_EMPLOYEE;

  // The window ends on the last day of the previous stint: the branch head is judging how this person
  // performed before leaving, not how they look today.
  const w = buildWindow(employeeId, loaded?.previousEndDate ?? todayIso(), 12);

  // Sequential on purpose: one connection, and a failing section must not abort the others.
  const header = await settle(() => loadHeaderSection(db, w));
  const attendance = await settle(() => loadAttendanceSection(db, w));
  const kpi = await settle(() => loadKpiSection(db, w));
  const leave = await settle(() => loadLeaveSection(db, w));
  const learning = await settle(() => loadLearningSection(db, w));
  const conduct = await settle(() => loadConductSection(db, w));
  const exit = await settle(() => loadExitSection(db, w));
  const payroll = await settle(() => loadPayrollSection(db, w));
  const timeline = await settle(() => loadTimelineSection(db, w));

  const att = attendance.status === "ok" ? attendance.data : null;
  const k = kpi.status === "ok" ? kpi.data : null;
  const c = conduct.status === "ok" ? conduct.data : null;
  const h = header.status === "ok" ? header.data : null;

  const verdict = buildVerdict({
    attendancePct: att?.attendancePct ?? null,
    avgLateMarksPerMonth: att?.late.avgLateMarksPerMonth ?? null,
    kpiMonthsAtTargetPct: k?.atTargetPct ?? null,
    kpiMonthsWithData: k?.monthsWithData ?? 0,
    activeWarnings: c?.activeWarnings ?? 0,
    finalWarnings: c?.finalWarnings ?? 0,
    openPip: c?.openPip ?? false,
    priorAbsconding: (c?.priorAbscondingExits ?? 0) > 0,
    tenureMonths: h?.tenureMonths ?? null,
  });

  return {
    request: {
      id: String(req.id),
      employeeId,
      status: String(req.status),
      proposedJoiningDate: String(req.proposed_joining_date),
      reason: String(req.reinstatement_reason ?? ""),
      raisedByRole: req.raised_by_role ?? null,
      gapDays: Number(req.gap_days ?? 0),
    },
    window: { start: w.start, end: w.end, months: w.months },
    eligibility,
    verdict,
    sections: { header, attendance, kpi, leave, learning, conduct, exit, payroll, timeline },
    generatedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `cd backend && npx vitest run src/modules/employees/rehire/dossier/__tests__/dossierService.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing route test**

`backend/src/modules/employees/rehire/__tests__/rejoinDossierRoutes.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { canViewEmployee } = vi.hoisted(() => ({ canViewEmployee: vi.fn() }));
vi.mock("../../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));

const { buildDossier } = vi.hoisted(() => ({ buildDossier: vi.fn() }));
vi.mock("../dossier/dossierService.js", () => ({ buildDossier }));

let authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
vi.mock("../../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

const { rejoinDossierRouter } = await import("../../rejoin-dossier.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/employees", rejoinDossierRouter); return a; };

beforeEach(() => {
  dbExecute.mockReset(); canViewEmployee.mockReset(); buildDossier.mockReset();
  canViewEmployee.mockResolvedValue(true);
  dbExecute.mockResolvedValue([[{ employee_id: "e1" }], []]);
  buildDossier.mockResolvedValue({ request: { id: "r1", employeeId: "e1" }, sections: {} });
});

describe("GET /reactivation/:id/dossier", () => {
  it("403s a role that has no business reading it", async () => {
    authUser = { id: "u1", role: "employee", roles: ["employee"] };
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(403);
    expect(buildDossier).not.toHaveBeenCalled();
  });

  it("404s an unknown request without building anything", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    dbExecute.mockResolvedValue([[], []]);
    const res = await request(app()).get("/api/employees/reactivation/nope/dossier");
    expect(res.status).toBe(404);
    expect(buildDossier).not.toHaveBeenCalled();
  });

  it("403s a branch head whose scope does not cover the employee, and builds nothing", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(403);
    expect(canViewEmployee).toHaveBeenCalledWith("bh1", "e1");
    expect(buildDossier).not.toHaveBeenCalled();
  });

  it.each(["branch_head", "hr", "admin", "super_admin"])("returns the dossier for %s", async (role) => {
    authUser = { id: "u1", role, roles: [role] };
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { request: { id: "r1", employeeId: "e1" }, sections: {} } });
  });

  it("500s with a message when the aggregator throws", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    buildDossier.mockRejectedValue(new Error("db gone"));
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx vitest run src/modules/employees/rehire/__tests__/rejoinDossierRoutes.test.ts`
Expected: FAIL — router module missing.

- [ ] **Step 7: Write the router**

`backend/src/modules/employees/rejoin-dossier.routes.ts`:

```ts
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { buildDossier } from "./rehire/dossier/dossierService.js";

export const rejoinDossierRouter = Router();

rejoinDossierRouter.use(requireAuth);

// The branch head decides on this page, so it is theirs first; HR and admins may read it to follow a
// request. Row scope is the same mechanism as every other reactivation route: a branch head only
// sees employees inside their own branch.
rejoinDossierRouter.get(
  "/reactivation/:id/dossier",
  requireRole("branch_head", "hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT employee_id FROM employee_reactivation_requests WHERE id = ?",
        [id],
      );
      if (!rows.length) return res.status(404).json({ success: false, message: "Request not found" });

      if (!(await canViewEmployee(req.authUser!.id, String(rows[0]!.employee_id)))) {
        return res.status(403).json({ success: false, message: "This request is not in your assigned scope" });
      }

      const dossier = await buildDossier(pool, String(id));
      if (!dossier) return res.status(404).json({ success: false, message: "Request not found" });
      return res.json({ success: true, data: dossier });
    } catch (err: any) {
      console.error("[RejoinDossier] failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to build dossier" });
    }
  },
);
```

- [ ] **Step 8: Mount it**

In `backend/src/app.ts`, next to the existing import of `employeeReactivationRouter` add:

```ts
import { rejoinDossierRouter } from "./modules/employees/rejoin-dossier.routes.js";
```

and directly after the line `app.use("/api/employees", employeeReactivationRouter);` (~line 653) add:

```ts
app.use("/api/employees", rejoinDossierRouter);
```

Then update the notes string for the employees domain in `backend/src/platform/domain-registry.ts` (~line 77) by appending ` + rejoinDossierRouter` after `employeeReactivationRouter`.

- [ ] **Step 9: Run the tests, type-check, and the route/registry guards**

Run: `cd backend && npx vitest run src/modules/employees/rehire && npx tsc --noEmit`
Expected: PASS, no type errors.

Run: `cd backend && npx vitest run src/platform src/modules/employees src/db tests 2>&1 | tail -20`
Expected: no NEW failures. The three known pre-existing failing files (`shivamgiri-schema-case`, `upload-batch-retention`, `esignDeadKitRedispatch`) may still fail; any other failure caused by the new router (route registry, domain registry, RBAC page matrix, schema-column-refs for the new SQL) must be fixed by registering the route/tables the way the guard asks, not by weakening the guard. If `schema-column-refs` flags a column that does not exist in `backend/sql/schema-snapshot.json`, that is a real wrong column in one of the new queries: fix the query against the snapshot.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/employees backend/src/app.ts backend/src/platform/domain-registry.ts
git commit -m "feat(rejoin-dossier): aggregator and GET /reactivation/:id/dossier

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verify the SQL against a real MySQL (no prod)

Every loader was tested with a fake executor, which proves the aggregation, **not** that the SQL runs. This task closes that gap.

**Files:** none committed except a throwaway script under the scratchpad directory.

- [ ] **Step 1: Build a scratch schema**

Start a throwaway `mysql:8.0` container (unique name, `--rm`, removed at the end; do not touch other containers or any real database). Create a database and apply, in order and skipping any file that errors because of unrelated foreign keys: the repo's base SQL for the tables the dossier reads (`backend/sql/002_employees.sql`, `005_attendance_wfm.sql` / `044_attendance_engine.sql` / `274_attendance_gaps.sql`, `006_leave.sql`, `010_kpi.sql`, `011_exit_management.sql`, `016_employee_lifecycle.sql`, `020_employee_reactivation.sql`, `020_lms_integration.sql`, the payroll and salary-prep SQL, `migrations/1891_employee_warning.sql`, `migrations/2079_employee_rejoin_v3.sql`, plus the CREATE TABLE files for `pip_record`, `performance_alert`, `coaching_session`, `employee_journey_log`, `employee_job_history`, `promotion_record`, `transfer_record`, `employee_loans`, `salary_advance_log`, `employee_deduction_entries`, `employee_salary_history`, `full_final_calculation`, `branch_master`, `process_master`, `designation_master`, `department_master` — find each with `grep -ln "CREATE TABLE[^;]*<name>" backend/sql/*.sql backend/sql/migrations/*.sql`). Where a table cannot be created from repo SQL, record it as "unverifiable here".

- [ ] **Step 2: Run each loader's SQL**

Write a small script (in the session scratchpad, not the repo) that imports each `load*Section` from `backend/src/modules/employees/rehire/dossier/` through `tsx`, runs it against the scratch database for a made-up employee id, and prints each section's result. Every loader must return without a SQL error (empty data is fine). For each failure, fix the query against the real column names in `backend/sql/schema-snapshot.json` and rerun, adding a one-line comment next to the fix if the original plan assumption was wrong.

- [ ] **Step 3: Seed a small realistic employee and compare**

Insert one employee with 3 months of `attendance_daily_record` rows (mix of `present`, `half_day`, `absent`, `week_off`, with `late_mark=1` on two days), one `employee_warning` (`final`, `active`), one approved `leave_request`, one exit with a pending clearance row, and one `salary_prep_run` (`finalized`) + `salary_prep_line`. Run `buildDossier` end to end with a real `employee_reactivation_requests` row. Check by hand that attendance %, late marks, warning counts, leave days and the verdict match the seeded facts.

- [ ] **Step 4: Tear down and report**

Remove the container. Report per loader: verified against scratch MySQL / unverifiable here, any query changed, and any assumption that turned out wrong. Commit only repo changes (query fixes and their tests):

```bash
git add backend/src
git commit -m "fix(rejoin-dossier): align dossier queries with the real schema

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Skip the commit if nothing changed.)

---

### Task 10: Full verification

- [ ] **Step 1:** `cd backend && npm run build && npx vitest run 2>&1 | tail -15` — expected: build passes; the only failing files are the three pre-existing ones (`shivamgiri-schema-case`, `upload-batch-retention`, `esignDeadKitRedispatch`). Confirm by name.
- [ ] **Step 2:** `graphify update .` from the repo root (project CLAUDE.md), if the command exists.
- [ ] **Step 3: Report plainly.** State what ran, what passed, and what was NOT exercised: no real login, nothing on prod, tables unverifiable in scratch MySQL, and the KPI/summary and LMS data being thin for leavers. Do not push or deploy.

---

## Self-Review

**Spec coverage (the 12 dossier items):**
1. Header → Task 7 (`dossier.header.ts`).
2. Verdict strip → Task 2 + aggregator Task 8.
3. Attendance, 12-month chart data → Task 3 (`months[]`).
4. Late coming (marks by month, average minutes, worst month) → Task 3 (`late`).
5. KPI trend, best/worst, share at target → Task 4.
6. Leave by type, planned vs unplanned, weekend pattern → Task 5 (unplanned is a documented short-notice heuristic: no flag exists).
7. Learning → Task 5.
8. Conduct (flag, warnings, prior rejoin, earlier absconding) → Task 6.
9. Exit file (reason, notice, NOC/clearance, assets, F&F) → Task 6.
10. Payroll footprint → Task 7.
11. Timeline → Task 7.
12. Requester note → `request.reason` and `request.raisedByRole` in Task 8. The proposed salary is not stored on the request today, so it is not shown; a salary field on the request is a follow-up for Plan 2b/3 if the owner wants it.

**Not in this plan:** the branch head page (Plan 2b), live exposure of the verdict thresholds as admin config (they are a constant now, `DEFAULT_THRESHOLDS`, overridable by argument), and any prod verification.

**Placeholders:** none; every step has code or an exact command.

**Type consistency:** `DossierWindow`, `SectionResult`, `SqlExecutor`, `settle`, `num`, `numOrNull`, `round1` (Task 1); `VerdictInputs`/`buildVerdict`/`DEFAULT_THRESHOLDS` (Task 2); section interfaces and loader names `loadAttendanceSection`, `loadKpiSection`, `loadLeaveSection`, `loadLearningSection`, `loadConductSection`, `loadExitSection`, `loadHeaderSection`, `loadPayrollSection`, `loadTimelineSection` are used identically in Task 8. `daysBetween` is imported from Plan 1's `rehireFacts.ts`.

**Known soft spots to watch during execution:** the test mocks match SQL by substring, so a key that matches two statements in one loader will return the wrong rows; adjust the SQL text, never the key. Task 9 exists because several tables' columns were read from SQL files rather than a live database.
