import { describe, expect, it, vi, type Mock } from "vitest";

/**
 * Salary start date - the one place that changes it.
 *
 * Payroll reads employees.salary_start_date to decide whether an employee is paid in a month and
 * for how many days, and selects the salary assignment by effective_from. Payroll Head assigns
 * the date. Before salary-start-date.service.ts, six code paths each wrote some of the five stored
 * copies and swallowed errors, so 73 of 213 HRMS-onboarded employees were being paid on a
 * different date from the one Payroll Head assigned.
 *
 * The date rules are pure functions and are tested directly. The write path is tested against a
 * small in-memory fake of the six tables it touches, so the assertions are about what ends up
 * stored - not about which SQL strings were issued.
 */

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn() },
}));

import {
  affectedPayrollMonths,
  applySalaryStartDate,
  assertSalaryDateNotOwnedByPayrollHead,
  checkSalaryStartDate,
  checkSalaryStartDateForCandidate,
  assessSalaryStartDate,
  actorAuthority,
  commitSalaryStartDate,
  dayOf,
  getSalaryStartDateConsistency,
  normaliseSalaryDate,
  prepareSalaryStartDate,
  type SqlExecutor,
} from "../salary-start-date.service.js";
import { db } from "../../../db/mysql.js";

// ── Pure rules ───────────────────────────────────────────────────────────────

describe("normaliseSalaryDate", () => {
  it("accepts a real YYYY-MM-DD date", () => {
    expect(normaliseSalaryDate("2026-09-18")).toBe("2026-09-18");
  });

  it.each([
    "2026-9-18",
    "18/09/2026",
    "",
    "2026-02-30",
    "2026-13-01",
    "not a date",
  ])("rejects %j", (bad) => {
    expect(() => normaliseSalaryDate(bad)).toThrow(
      /valid YYYY-MM-DD|real calendar date/,
    );
  });

  it("rejects a non-string", () => {
    expect(() => normaliseSalaryDate(null)).toThrow();
    expect(() => normaliseSalaryDate(20260918)).toThrow();
  });
});

describe("affectedPayrollMonths", () => {
  it("returns no month when every copy already carries the target date", () => {
    expect(
      affectedPayrollMonths(["2026-09-18", "2026-09-18", null], "2026-09-18"),
    ).toEqual([]);
  });

  it("spans from the earliest to the latest date, inclusive", () => {
    expect(
      affectedPayrollMonths(["2026-08-25", "2026-09-18"], "2026-09-18"),
    ).toEqual(["2026-08", "2026-09"]);
  });

  it("crosses a year boundary", () => {
    expect(affectedPayrollMonths(["2026-11-05"], "2027-02-01")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });
});

describe("actorAuthority", () => {
  it("splits ownership (reviewer tier) from the backdating exemption, exactly like canBackdateDates", () => {
    expect(actorAuthority(["payroll_head"])).toEqual({ authority: "payroll_head", allowBackdate: true });
    expect(actorAuthority(["super_admin"])).toEqual({ authority: "payroll_head", allowBackdate: true });
    // admin may change an approved salary's date but is NOT exempt from the date locks.
    expect(actorAuthority(["hr", "admin"])).toEqual({ authority: "payroll_head", allowBackdate: false });
    expect(actorAuthority(["hr"])).toEqual({ authority: "standard", allowBackdate: false });
    expect(actorAuthority(["payroll_hr", "branch_head"])).toEqual({ authority: "standard", allowBackdate: false });
    expect(actorAuthority([])).toEqual({ authority: "standard", allowBackdate: false });
    expect(actorAuthority(undefined)).toEqual({ authority: "standard", allowBackdate: false });
  });
});

describe("assessSalaryStartDate", () => {
  const base = {
    dateOfJoining: "2026-09-10",
    today: "2026-09-25",
    unchangedFrom: [] as unknown[],
  };

  it("accepts a date on or after both joining and today, for anyone", () => {
    for (const allowBackdate of [false, true]) {
      expect(
        assessSalaryStartDate({ ...base, newDate: "2026-09-25", allowBackdate }),
      ).toEqual({ preJoining: false, beforeToday: false, unchanged: false });
    }
  });

  it("refuses a date before joining for standard authority", () => {
    expect(() =>
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-05",
        allowBackdate: false,
      }),
    ).toThrow(/before date of joining/);
  });

  it("refuses a date before today (but on/after joining) for standard authority", () => {
    expect(() =>
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-15",
        allowBackdate: false,
      }),
    ).toThrow(/before today/);
  });

  it("lets payroll_head go before joining only with a reason of at least 5 characters", () => {
    expect(() =>
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-05",
        allowBackdate: true,
      }),
    ).toThrow(/reason of at least 5 characters/);
    expect(() =>
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-05",
        allowBackdate: true,
        reason: "abc",
      }),
    ).toThrow(/reason of at least 5 characters/);
    expect(
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-05",
        allowBackdate: true,
        reason: "Trained before joining",
      }),
    ).toEqual({ preJoining: true, beforeToday: true, unchanged: false });
  });

  it("lets payroll_head go before today (after joining) only with a reason", () => {
    expect(() =>
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-15",
        allowBackdate: true,
      }),
    ).toThrow(/reason/);
    expect(
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-15",
        allowBackdate: true,
        reason: "Backdated per HR",
      }),
    ).toEqual({ preJoining: false, beforeToday: true, unchanged: false });
  });

  it("allows re-saving a date the record already carries without a reason", () => {
    expect(
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-12",
        allowBackdate: true,
        unchangedFrom: [null, "2026-09-12"],
      }),
    ).toEqual({ preJoining: false, beforeToday: true, unchanged: true });
  });

  it("still refuses standard authority re-saving a pre-joining date (only payroll_head may hold the flag)", () => {
    expect(() =>
      assessSalaryStartDate({
        ...base,
        newDate: "2026-09-05",
        allowBackdate: false,
        unchangedFrom: ["2026-09-05"],
      }),
    ).toThrow(/before date of joining/);
  });

  it("does not require a reason when the joining date is unknown and the date is today or later", () => {
    expect(
      assessSalaryStartDate({
        ...base,
        dateOfJoining: null,
        newDate: "2026-09-25",
        allowBackdate: false,
      }),
    ).toMatchObject({ preJoining: false, beforeToday: false });
  });
});

// ── Write path against an in-memory fake ─────────────────────────────────────

interface FakeState {
  employee: {
    id: string;
    employee_code: string;
    date_of_joining: string;
    salary_start_date: string | null;
    salary_start_pre_joining_approved: number;
    candidate_id: string | null;
    branch_id: string | null;
    process_id: string | null;
  };
  review: {
    id: string;
    status: string;
    candidate_id: string;
    package_effective_from: string | null;
  } | null;
  validation: { id: string; salary_start_date: string | null } | null;
  assignments: Array<{
    id: string;
    effective_from: string;
    active_status: number;
  }>;
  component: { id: string; effective_date: string } | null;
  runs: Array<{
    id: string;
    run_month: string;
    status: string;
    branch_id: string | null;
    process_id: string | null;
  }>;
  audit: Array<Record<string, unknown>>;
  /** A salary increment / Salary Change Center change is on record. */
  hasSalaryChange?: boolean;
  failEmployeeUpdate?: boolean;
  dropValidationWrite?: boolean;
}

function newState(over: Partial<FakeState> = {}): FakeState {
  return {
    employee: {
      id: "emp-1",
      employee_code: "MAS63435",
      date_of_joining: "2026-08-31",
      salary_start_date: "2026-08-31",
      salary_start_pre_joining_approved: 0,
      candidate_id: "cand-1",
      branch_id: "branch-1",
      process_id: "proc-1",
    },
    review: {
      id: "rev-1",
      status: "pending_review",
      candidate_id: "cand-1",
      package_effective_from: "2026-08-31",
    },
    validation: { id: "val-1", salary_start_date: "2026-08-31" },
    assignments: [
      { id: "asg-1", effective_from: "2026-08-31", active_status: 1 },
    ],
    component: { id: "sca-1", effective_date: "2026-08-31" },
    runs: [],
    audit: [],
    ...over,
  };
}

/** Routes each SQL statement the service issues to the fake state, by table and verb. */
function fakeExec(state: FakeState): SqlExecutor {
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    const empty: [unknown[], unknown[]] = [[], []];

    if (q.includes("employee_salary_change_log"))
      return [[{ n: state.hasSalaryChange ? 1 : 0 }], []];

    if (q.startsWith("SELECT e.salary_start_date FROM employee_payroll_head_review r JOIN employees e")) {
      const approved = state.review?.status === "approved" && state.review.candidate_id === params[0];
      return [approved ? [{ salary_start_date: state.employee.salary_start_date }] : [], []];
    }

    if (q.startsWith("SELECT id, employee_code, date_of_joining"))
      return [[{ ...state.employee }], []];
    if (q.startsWith("SELECT salary_start_pre_joining_approved AS f"))
      return [[{ f: state.employee.salary_start_pre_joining_approved }], []];
    if (q.includes("FROM employee_payroll_head_review WHERE employee_id"))
      return [state.review ? [{ ...state.review }] : [], []];
    if (q.includes("FROM ats_payroll_hr_validation"))
      return [state.validation ? [{ ...state.validation }] : [], []];
    if (q.includes("FROM employee_salary_assignment"))
      return [
        [...state.assignments]
          .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
          .map((a) => ({ ...a })),
        [],
      ];
    if (q.includes("FROM salary_component_assignments"))
      return [state.component ? [{ ...state.component }] : [], []];
    if (q.includes("FROM salary_prep_run")) {
      const [first, last, branch, proc] = params as [
        string,
        string,
        string | null,
        string | null,
      ];
      return [
        state.runs
          .filter((r) => r.run_month >= first && r.run_month <= last)
          .filter(
            (r) =>
              (r.branch_id === null || r.branch_id === branch) &&
              (r.process_id === null || r.process_id === proc),
          )
          .map((r) => ({ ...r })),
        [],
      ];
    }

    if (q.startsWith("UPDATE employees SET salary_start_date")) {
      if (state.failEmployeeUpdate)
        throw Object.assign(new Error("chk_ssd_not_before_doj_v2 violated"), {
          code: "ER_CHECK_CONSTRAINT_VIOLATED",
        });
      state.employee.salary_start_date = params[0] as string;
      state.employee.salary_start_pre_joining_approved = params[1] as number;
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith("UPDATE ats_payroll_hr_validation")) {
      if (!state.dropValidationWrite && state.validation)
        state.validation.salary_start_date = params[0] as string;
      return [{ affectedRows: 1 }, []];
    }
    if (
      q.startsWith(
        "UPDATE employee_payroll_head_review SET package_effective_from",
      )
    ) {
      if (state.review)
        state.review.package_effective_from = params[0] as string;
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith("UPDATE employee_salary_assignment SET effective_from")) {
      const row = state.assignments.find((a) => a.id === params[1]);
      if (row) row.effective_from = params[0] as string;
      return [{ affectedRows: 1 }, []];
    }
    if (
      q.startsWith("UPDATE salary_component_assignments SET effective_date")
    ) {
      if (state.component) state.component.effective_date = params[0] as string;
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith("INSERT INTO employee_salary_start_date_audit")) {
      const [
        employee_id,
        old_date,
        new_date,
        source,
        authority,
        pre_joining,
        before_today,
        reason,
        actor,
        copies,
      ] = params;
      state.audit.push({
        employee_id,
        old_date,
        new_date,
        source,
        authority,
        pre_joining,
        before_today,
        reason,
        actor,
        copies,
      });
      return [{ affectedRows: 1 }, []];
    }
    return empty;
  });
  return { execute } as unknown as SqlExecutor;
}

const PH = {
  actorUserId: "user-ph",
  authority: "payroll_head" as const,
  allowBackdate: true,
  source: "payroll_head_change_start_date" as const,
};

describe("applySalaryStartDate", () => {
  it("writes every stored copy to the new date and records an audit row", async () => {
    const state = newState();
    const result = await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-09-30",
      today: "2026-09-25",
    });

    expect(state.employee.salary_start_date).toBe("2026-09-30");
    expect(state.validation?.salary_start_date).toBe("2026-09-30");
    expect(state.review?.package_effective_from).toBe("2026-09-30");
    expect(state.assignments[0].effective_from).toBe("2026-09-30");
    expect(state.component?.effective_date).toBe("2026-09-30");
    expect(state.employee.salary_start_pre_joining_approved).toBe(0);
    expect(result).toMatchObject({
      changed: true,
      oldDate: "2026-08-31",
      newDate: "2026-09-30",
      preJoining: false,
    });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      old_date: "2026-08-31",
      new_date: "2026-09-30",
      source: "payroll_head_change_start_date",
    });
  });

  it("backdating before joining by Payroll Head sets the pre-joining flag on employees and needs a reason", async () => {
    const state = newState({
      employee: {
        ...newState().employee,
        date_of_joining: "2026-08-31",
        salary_start_date: "2026-08-31",
      },
    });
    await expect(
      applySalaryStartDate(fakeExec(state), {
        ...PH,
        employeeId: "emp-1",
        newDate: "2026-08-25",
        today: "2026-09-25",
      }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(state.employee.salary_start_date).toBe("2026-08-31"); // nothing written

    const result = await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-08-25",
      reason: "Trainee started training on 25 Aug",
      today: "2026-09-25",
    });
    expect(state.employee.salary_start_date).toBe("2026-08-25");
    expect(state.employee.salary_start_pre_joining_approved).toBe(1);
    expect(result).toMatchObject({ preJoining: true, beforeToday: true });
    expect(state.audit[0]).toMatchObject({
      pre_joining: 1,
      reason: "Trainee started training on 25 Aug",
    });
  });

  it("clears the pre-joining flag again when the date moves back to on/after joining", async () => {
    const state = newState();
    state.employee.salary_start_date = "2026-08-25";
    state.employee.salary_start_pre_joining_approved = 1;
    await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-08-31",
      reason: "Restored to joining date",
      today: "2026-09-25",
    });
    expect(state.employee.salary_start_pre_joining_approved).toBe(0);
  });

  it("refuses standard authority a date before joining and never sets the flag", async () => {
    const state = newState();
    await expect(
      applySalaryStartDate(fakeExec(state), {
        actorUserId: "user-hr",
        authority: "standard",
        source: "employee_edit",
        employeeId: "emp-1",
        newDate: "2026-08-25",
        today: "2026-08-20",
      }),
    ).rejects.toMatchObject({ code: "SALARY_START_BEFORE_JOINING" });
    expect(state.employee.salary_start_pre_joining_approved).toBe(0);
    expect(state.audit).toHaveLength(0);
  });

  it("refuses standard authority once Payroll Head has approved, but lets Payroll Head through", async () => {
    const state = newState();
    state.review!.status = "approved";

    await expect(
      applySalaryStartDate(fakeExec(state), {
        actorUserId: "user-hr",
        authority: "standard",
        source: "employee_edit",
        employeeId: "emp-1",
        newDate: "2026-09-30",
        today: "2026-09-25",
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SALARY_DATE_OWNED_BY_PAYROLL_HEAD",
    });
    expect(state.employee.salary_start_date).toBe("2026-08-31");

    await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-09-30",
      today: "2026-09-25",
    });
    expect(state.employee.salary_start_date).toBe("2026-09-30");
  });

  it("lets admin change an approved salary's date (reviewer tier) but not before today/joining (no backdate exemption)", async () => {
    const state = newState();
    state.review!.status = "approved";
    const admin = { actorUserId: "user-admin", authority: "payroll_head" as const, allowBackdate: false, source: "revision_request_approved" as const };

    await expect(
      applySalaryStartDate(fakeExec(state), { ...admin, employeeId: "emp-1", newDate: "2026-08-25", reason: "some reason", today: "2026-09-25" }),
    ).rejects.toMatchObject({ code: "SALARY_START_BEFORE_JOINING" });
    expect(state.employee.salary_start_date).toBe("2026-08-31");

    await expect(
      applySalaryStartDate(fakeExec(state), { ...admin, employeeId: "emp-1", newDate: "2026-09-30", today: "2026-09-25" }),
    ).resolves.toMatchObject({ changed: true });
    expect(state.employee.salary_start_date).toBe("2026-09-30");
  });

  it("rejects a change that reaches into a finalized payroll month, and writes nothing", async () => {
    const state = newState();
    state.runs = [
      {
        id: "run-8",
        run_month: "2026-08",
        status: "FINALIZED",
        branch_id: null,
        process_id: null,
      },
    ];
    await expect(
      applySalaryStartDate(fakeExec(state), {
        ...PH,
        employeeId: "emp-1",
        newDate: "2026-09-30",
        today: "2026-09-25",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "PAYROLL_MONTH_CLOSED" });
    expect(state.employee.salary_start_date).toBe("2026-08-31");
    expect(state.assignments[0].effective_from).toBe("2026-08-31");
    expect(state.audit).toHaveLength(0);
  });

  it("does not treat a run scoped to another branch as covering this employee", async () => {
    const state = newState();
    state.runs = [
      {
        id: "run-8",
        run_month: "2026-08",
        status: "locked",
        branch_id: "other-branch",
        process_id: null,
      },
    ];
    await expect(
      applySalaryStartDate(fakeExec(state), {
        ...PH,
        employeeId: "emp-1",
        newDate: "2026-09-30",
        today: "2026-09-25",
      }),
    ).resolves.toMatchObject({ changed: true });
  });

  it("allows a change whose months are all open and reports the open, already-calculated run to recalculate", async () => {
    const state = newState();
    state.runs = [
      {
        id: "run-8",
        run_month: "2026-08",
        status: "processing",
        branch_id: null,
        process_id: null,
      },
    ];
    const result = await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-08-28",
      reason: "Moved to actual start",
      today: "2026-08-20",
    });
    expect(result.openRunsToRecalculate).toEqual([
      { runId: "run-8", runMonth: "2026-08", status: "processing" },
    ]);
  });

  it("is a clean no-op (no month checked, all copies still equal) when re-saving the same date", async () => {
    const state = newState();
    state.runs = [
      {
        id: "run-8",
        run_month: "2026-08",
        status: "FINALIZED",
        branch_id: null,
        process_id: null,
      },
    ];
    const result = await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-08-31",
      today: "2026-09-25",
    });
    expect(result.changed).toBe(false);
    expect(state.employee.salary_start_date).toBe("2026-08-31");
  });

  it("repairs a drifted copy when the same date is re-saved (the 73-employee case)", async () => {
    // Payroll Head assigned 25 Aug; employees still carries the joining date.
    const state = newState();
    state.employee.salary_start_date = "2026-08-31";
    state.employee.date_of_joining = "2026-08-31";
    state.validation!.salary_start_date = "2026-08-25";
    state.review!.package_effective_from = "2026-08-25";
    state.assignments = [
      { id: "asg-1", effective_from: "2026-08-25", active_status: 1 },
    ];
    state.component = { id: "sca-1", effective_date: "2026-08-25" };

    await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-08-25",
      reason: "Payroll Head assigned start",
      today: "2026-09-25",
    });

    expect(state.employee.salary_start_date).toBe("2026-08-25");
    expect(state.employee.salary_start_pre_joining_approved).toBe(1);
    expect(
      (await getSalaryStartDateConsistency(fakeExec(state), "emp-1"))
        .consistent,
    ).toBe(true);
  });

  it("fails loudly - instead of swallowing - when the employees write is refused", async () => {
    const state = newState();
    state.failEmployeeUpdate = true;
    await expect(
      applySalaryStartDate(fakeExec(state), {
        ...PH,
        employeeId: "emp-1",
        newDate: "2026-09-30",
        today: "2026-09-25",
      }),
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });

  it("throws SALARY_START_DATE_SYNC_FAILED when a copy still disagrees after the writes", async () => {
    const state = newState();
    state.dropValidationWrite = true; // the validation UPDATE silently does not take
    await expect(
      applySalaryStartDate(fakeExec(state), {
        ...PH,
        employeeId: "emp-1",
        newDate: "2026-09-30",
        today: "2026-09-25",
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "SALARY_START_DATE_SYNC_FAILED",
    });
  });

  it("leaves a later increment assignment on its own date and updates only the row carrying the start date", async () => {
    const state = newState();
    state.hasSalaryChange = true; // the 2027-04-01 row is an increment, not a stale start date
    state.assignments = [
      { id: "asg-old", effective_from: "2026-08-31", active_status: 0 },
      { id: "asg-inc", effective_from: "2027-04-01", active_status: 1 },
    ];
    await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-09-30",
      today: "2026-09-25",
    });
    expect(
      state.assignments.find((a) => a.id === "asg-inc")!.effective_from,
    ).toBe("2027-04-01");
    expect(state.employee.salary_start_date).toBe("2026-09-30");
  });
});

describe("assignment rows: increments versus stale start-date rows", () => {
  it("repairs a stale active assignment row whose date nobody else holds, when the employee has no salary change on record", async () => {
    // employees says 08-31, Payroll Head's copies say 08-25, but the active row sits on 09-19 (unexplained).
    const state = newState();
    state.validation!.salary_start_date = "2026-08-25";
    state.review!.package_effective_from = "2026-08-25";
    state.assignments = [
      { id: "asg-1", effective_from: "2026-08-25", active_status: 0 },
      { id: "asg-2", effective_from: "2026-09-19", active_status: 1 },
    ];
    await applySalaryStartDate(fakeExec(state), {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-08-25",
      reason: "Payroll Head assigned start",
      today: "2026-09-25",
    });
    expect(state.assignments.find((a) => a.id === "asg-2")!.effective_from).toBe("2026-08-25");
    expect((await getSalaryStartDateConsistency(fakeExec(state), "emp-1")).consistent).toBe(true);
  });

  it("never rewrites an increment: a single active row on a later date stays put for an employee with a salary change", async () => {
    const state = newState();
    state.hasSalaryChange = true;
    state.assignments = [{ id: "asg-1", effective_from: "2026-10-01", active_status: 1 }];
    await applySalaryStartDate(fakeExec(state), { ...PH, employeeId: "emp-1", newDate: "2026-09-30", today: "2026-09-25" });
    expect(state.assignments[0].effective_from).toBe("2026-10-01");
  });

  it("does not call an incremented employee inconsistent just because the assignment date moved on", async () => {
    const state = newState();
    state.hasSalaryChange = true;
    state.assignments = [{ id: "asg-1", effective_from: "2026-10-01", active_status: 1 }];
    expect((await getSalaryStartDateConsistency(fakeExec(state), "emp-1")).consistent).toBe(true);
  });

  it("still calls a stale assignment inconsistent when nothing explains its date", async () => {
    const state = newState();
    state.assignments = [{ id: "asg-1", effective_from: "2026-10-01", active_status: 1 }];
    expect((await getSalaryStartDateConsistency(fakeExec(state), "emp-1")).consistent).toBe(false);
  });

  it("leaves a superseded component assignment's history date alone when the caller already inserted the new one", async () => {
    // writeComponentAssignment supersedes the old row and inserts a new active one on the new date
    // between prepare and commit; commit must see the NEW row, not rewrite the old one.
    const state = newState();
    const exec = fakeExec(state);
    const prepared = await prepareSalaryStartDate(exec, { ...PH, employeeId: "emp-1", newDate: "2026-09-30", today: "2026-09-25", assignmentAlreadyWritten: true });
    state.component = { id: "sca-new", effective_date: "2026-09-30" };
    state.assignments[0].effective_from = "2026-09-30";
    const result = await commitSalaryStartDate(exec, prepared);
    expect(result.copiesWritten).not.toContain("salary_component_assignments.effective_date");
  });
});

describe("checkSalaryStartDate (validation only, always rolled back)", () => {
  function connectionFor(state: FakeState) {
    const exec = fakeExec(state);
    const connection = {
      execute: (exec as unknown as { execute: Mock }).execute,
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    (db.getConnection as unknown as Mock).mockResolvedValue(connection);
    return connection;
  }

  it("passes a valid change without writing anything, and rolls back", async () => {
    const state = newState();
    const connection = connectionFor(state);
    await expect(checkSalaryStartDate({ ...PH, employeeId: "emp-1", newDate: "2026-09-30", today: "2026-09-25" })).resolves.toBeUndefined();
    expect(state.employee.salary_start_date).toBe("2026-08-31");
    expect(state.audit).toHaveLength(0);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("throws the same refusal the real write would, and still rolls back and releases", async () => {
    const state = newState();
    state.runs = [{ id: "run-8", run_month: "2026-08", status: "FINALIZED", branch_id: null, process_id: null }];
    const connection = connectionFor(state);
    await expect(
      checkSalaryStartDate({ ...PH, employeeId: "emp-1", newDate: "2026-09-30", today: "2026-09-25" }),
    ).rejects.toMatchObject({ code: "PAYROLL_MONTH_CLOSED" });
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("checkSalaryStartDateForCandidate does nothing before the employee record exists", async () => {
    (db.execute as unknown as Mock).mockResolvedValue([[], []]);
    await expect(
      checkSalaryStartDateForCandidate({ candidateId: "cand-x", newDate: "2026-09-30", actorUserId: null, source: "joining_control_room" }),
    ).resolves.toBeUndefined();
  });
});

describe("prepare / commit split (the Payroll Head package paths)", () => {
  it("prepare enforces the locks BEFORE the caller writes its own rows, and writes nothing itself", async () => {
    const state = newState();
    await expect(
      prepareSalaryStartDate(fakeExec(state), {
        ...PH,
        employeeId: "emp-1",
        newDate: "2026-08-25",
        today: "2026-09-25",
      }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(state.audit).toHaveLength(0);
    expect(state.employee.salary_start_date).toBe("2026-08-31");
  });

  it("commit verifies an assignment the caller already wrote, and fails if it does not carry the date", async () => {
    const state = newState();
    const exec = fakeExec(state);
    const prepared = await prepareSalaryStartDate(exec, {
      ...PH,
      employeeId: "emp-1",
      newDate: "2026-09-30",
      today: "2026-09-25",
      assignmentAlreadyWritten: true,
    });
    // The caller "forgot" to write the assignment.
    await expect(commitSalaryStartDate(exec, prepared)).rejects.toMatchObject({
      code: "SALARY_START_DATE_SYNC_FAILED",
    });

    // Now the caller writes it first, as writeComponentAssignment does.
    state.assignments[0].effective_from = "2026-09-30";
    await expect(commitSalaryStartDate(exec, prepared)).resolves.toMatchObject({
      newDate: "2026-09-30",
    });
  });
});

describe("getSalaryStartDateConsistency", () => {
  it("reports each copy that differs from employees.salary_start_date", async () => {
    const state = newState();
    state.validation!.salary_start_date = "2026-08-25";
    state.review!.package_effective_from = "2026-08-26";
    state.assignments[0].effective_from = "2026-08-27";
    const check = await getSalaryStartDateConsistency(fakeExec(state), "emp-1");
    expect(check.consistent).toBe(false);
    expect(check.expected).toBe("2026-08-31");
    expect(check.problems).toHaveLength(3);
  });

  it("is consistent when every copy agrees, and ignores a package that was never assigned", async () => {
    const state = newState();
    state.review!.package_effective_from = null;
    expect(
      (await getSalaryStartDateConsistency(fakeExec(state), "emp-1"))
        .consistent,
    ).toBe(true);
  });
});

describe("dayOf", () => {
  it("never shifts a date through the timezone", () => {
    expect(dayOf("2026-08-31T18:30:00.000Z")).toBe("2026-08-31");
    expect(dayOf(new Date(2026, 7, 31))).toBe("2026-08-31");
    expect(dayOf(null)).toBe("");
  });
});

describe("assertSalaryDateNotOwnedByPayrollHead (Joining Control Room / Payroll HR validation guard)", () => {
  it("refuses a different date once Payroll Head has approved the candidate's salary", async () => {
    const state = newState();
    state.review!.status = "approved";
    await expect(
      assertSalaryDateNotOwnedByPayrollHead(fakeExec(state), "cand-1", "2026-09-30"),
    ).rejects.toMatchObject({ statusCode: 403, code: "SALARY_DATE_OWNED_BY_PAYROLL_HEAD" });
  });

  it("allows re-saving the date the employee already carries", async () => {
    const state = newState();
    state.review!.status = "approved";
    await expect(
      assertSalaryDateNotOwnedByPayrollHead(fakeExec(state), "cand-1", "2026-08-31"),
    ).resolves.toBeUndefined();
  });

  it("does nothing while the salary review is still pending, or before an employee exists", async () => {
    const pending = newState();
    await expect(
      assertSalaryDateNotOwnedByPayrollHead(fakeExec(pending), "cand-1", "2026-09-30"),
    ).resolves.toBeUndefined();
    await expect(
      assertSalaryDateNotOwnedByPayrollHead(fakeExec(newState({ review: null })), "cand-1", "2026-09-30"),
    ).resolves.toBeUndefined();
  });

  it("ignores an empty date (Joining Control Room saves that leave the date untouched)", async () => {
    const state = newState();
    state.review!.status = "approved";
    await expect(assertSalaryDateNotOwnedByPayrollHead(fakeExec(state), "cand-1", "")).resolves.toBeUndefined();
    await expect(assertSalaryDateNotOwnedByPayrollHead(fakeExec(state), "cand-1", null)).resolves.toBeUndefined();
  });
});
