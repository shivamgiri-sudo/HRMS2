import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
// createEmployee fans out to LMS provisioning and IT/WFM join tasks after the row exists; both
// are best-effort side effects with their own suites, stubbed so they consume no db.execute calls.
vi.mock("../src/modules/lms/lms-provisioning.service.js", () => ({
  provisionLmsIdentityForEmployee: vi.fn(async () => ({})),
}));
vi.mock("../src/modules/it-provisioning/it-provisioning.service.js", () => ({
  dispatchJoinProvisioningTasks: vi.fn(async () => undefined),
}));
// updateEmployee no longer writes salary_start_date itself: the date has five stored copies, so
// it is validated and written by the central payroll service (which has its own suite).
const { checkSalaryStartDate, setSalaryStartDate } = vi.hoisted(() => ({
  checkSalaryStartDate: vi.fn(async () => undefined),
  setSalaryStartDate: vi.fn(async () => undefined),
}));
vi.mock("../src/modules/payroll/salary-start-date.service.js", () => ({
  checkSalaryStartDate,
  setSalaryStartDate,
  dayOf: (v: unknown) => (v == null || v === "" ? null : String(v).slice(0, 10)),
}));
import { db } from "../src/db/mysql.js";
import { employeeService } from "../src/modules/employees/employee.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;

const fakeEmployee = {
  id: "emp-1",
  employee_code: "MCN001",
  first_name: "Ravi",
  last_name: "Kumar",
  full_name: "Ravi Kumar",
  email: "ravi@mcn.com",
  mobile: "9999999999",
  gender: "Male",
  date_of_joining: "2026-01-01",
  salary_start_date: "2026-01-01",
  employment_type: "Full Time",
  employment_status: "Active",
  active_status: 1,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockReset().mockResolvedValue([[], []]);
});

/**
 * createEmployee now runs duplicate checks, the INSERT, auth_user creation + linking and the
 * default-role grant before it re-fetches the row, so the flow is keyed on the statement rather
 * than on call position. `refetched` is what the final getEmployee returns.
 */
function mockCreateFlow(refetched: Record<string, unknown>) {
  exec.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/^SELECT \*[\s\S]*FROM employees WHERE id = \?/i.test(text)) return [[refetched], []];
    if (/^\s*(INSERT|UPDATE)\b/i.test(text)) return [{ affectedRows: 1 }, []];
    return [[], []]; // no duplicate code / PAN / email, no existing auth_user
  });
}

/** Parameters of the INSERT INTO employees statement, keyed by the columns under test. */
function insertedEmployee() {
  const call = exec.mock.calls.find(([sql]) => /^\s*INSERT INTO employees\b/i.test(String(sql)));
  expect(call, "expected an INSERT INTO employees").toBeTruthy();
  const p = call![1] as unknown[];
  return { employee_code: p[1], date_of_joining: p[8], salary_start_date: p[9] };
}

// ─── Create ───────────────────────────────────────────────────────────────────

describe("employeeService.createEmployee", () => {
  it("creates employee with salary_start_date defaulting to date_of_joining", async () => {
    mockCreateFlow(fakeEmployee);
    const r = await employeeService.createEmployee({
      employeeCode: "MCN001",
      firstName: "Ravi",
      dateOfJoining: "2026-01-01",
    }, "user-1");
    expect(r.employee_code).toBe("MCN001");
    expect(r.salary_start_date).toBe("2026-01-01"); // defaults to doj
    expect(insertedEmployee()).toEqual({
      employee_code: "MCN001", date_of_joining: "2026-01-01", salary_start_date: "2026-01-01",
    });
  });

  it("creates employee with explicit salary_start_date", async () => {
    mockCreateFlow({ ...fakeEmployee, salary_start_date: "2026-02-01" });
    const r = await employeeService.createEmployee({
      employeeCode: "MCN002",
      firstName: "Priya",
      dateOfJoining: "2026-01-15",
      salaryStartDate: "2026-02-01",
    }, "user-1");
    expect(r.salary_start_date).toBe("2026-02-01");
    expect(insertedEmployee()).toEqual({
      employee_code: "MCN002", date_of_joining: "2026-01-15", salary_start_date: "2026-02-01",
    });
  });

  it("refuses a salary_start_date before date_of_joining, and inserts nothing", async () => {
    mockCreateFlow(fakeEmployee);
    await expect(employeeService.createEmployee({
      employeeCode: "MCN005",
      firstName: "Priya",
      dateOfJoining: "2026-02-01",
      salaryStartDate: "2026-01-15",
    }, "user-1")).rejects.toMatchObject({ statusCode: 400, code: "SALARY_START_BEFORE_JOINING" });
    expect(exec.mock.calls.some(([sql]) => /^\s*INSERT INTO employees\b/i.test(String(sql)))).toBe(false);
  });

  it("throws on duplicate employee_code", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // duplicate found
    await expect(
      employeeService.createEmployee(
        {
          employeeCode: "MCN001",
          firstName: "Test",
          dateOfJoining: "2026-01-01",
        },
        "user-1",
      ),
    ).rejects.toThrow("Employee code already exists");
  });
});

// ─── Get ──────────────────────────────────────────────────────────────────────

describe("employeeService.getEmployee", () => {
  it("returns employee by id", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    const r = await employeeService.getEmployee("emp-1");
    expect(r.employee_code).toBe("MCN001");
  });

  it("throws when not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(employeeService.getEmployee("nope")).rejects.toThrow(
      "Employee not found",
    );
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────

describe("employeeService.listEmployees", () => {
  it("returns paginated employees", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    const r = await employeeService.listEmployees({ page: 1, limit: 50 });
    expect(r.data).toHaveLength(1);
    expect(r.total).toBe(1);
  });

  it("filters by employment_status", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    await employeeService.listEmployees({
      page: 1,
      limit: 50,
      status: "Active",
    });
    const query = exec.mock.calls[0][0] as string;
    expect(query).toContain("employment_status");
  });

  it("filters by process_id", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    await employeeService.listEmployees({
      page: 1,
      limit: 50,
      processId: "proc-1",
    });
    const query = exec.mock.calls[0][0] as string;
    expect(query).toContain("process_id");
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

describe("employeeService.updateEmployee", () => {
  it("updates allowed fields", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // getEmployee
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    // mobile is now in SENSITIVE_FIELDS (previously only Employment fields were), so
    // changing it fires an audit-log write. void logSensitiveAction(...) invokes its
    // async body synchronously up to its own first await, so its db.execute() call
    // consumes a queued mock value before the re-fetch below does.
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit log INSERT
    exec.mockResolvedValueOnce([
      [{ ...fakeEmployee, mobile: "8888888888" }],
      [],
    ]); // re-fetch
    const r = await employeeService.updateEmployee(
      "emp-1",
      { mobile: "8888888888" },
      "user-1",
    );
    expect(r.mobile).toBe("8888888888");
  });

  it("updates salary_start_date independently", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);                                       // snapshot
    exec.mockResolvedValueOnce([[{ ...fakeEmployee, salary_start_date: "2026-03-01" }], []]); // re-fetch
    const r = await employeeService.updateEmployee("emp-1", { salaryStartDate: "2026-03-01" }, "user-1");
    expect(r.salary_start_date).toBe("2026-03-01");

    // Validated first, then written, both through the central service with the same request.
    const change = {
      employeeId: "emp-1", newDate: "2026-03-01", actorUserId: "user-1",
      source: "employee_edit", authority: "standard", allowBackdate: false,
    };
    expect(checkSalaryStartDate).toHaveBeenCalledWith(change);
    expect(setSalaryStartDate).toHaveBeenCalledWith(change);
    expect(checkSalaryStartDate.mock.invocationCallOrder[0])
      .toBeLessThan(setSalaryStartDate.mock.invocationCallOrder[0]);
    // ...and never by a direct UPDATE here, which would move one of the five copies alone.
    expect(exec.mock.calls.some(([sql]) => /^\s*UPDATE employees/i.test(String(sql)))).toBe(false);
  });

  it("refuses a salary_start_date before the stored date_of_joining, and writes nothing", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // snapshot: doj 2026-01-01
    await expect(
      employeeService.updateEmployee("emp-1", { salaryStartDate: "2025-12-15" }, "user-1"),
    ).rejects.toMatchObject({ statusCode: 400, code: "SALARY_START_BEFORE_JOINING" });
    expect(setSalaryStartDate).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("no-ops when no fields provided", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]);
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // re-fetch (no UPDATE call)
    const r = await employeeService.updateEmployee("emp-1", {}, "user-1");
    expect(r.employee_code).toBe("MCN001");
    expect(
      exec.mock.calls.some(([sql]) =>
        /^\s*UPDATE employees/i.test(sql as string),
      ),
    ).toBe(false);
  });

  // Previously only Employment fields (branch/department/process/designation/reporting
  // manager/employment status+type) were audited on admin edits — a name, contact, DOB,
  // address or date-of-joining change wrote silently, with no before/after row at all.
  it.each([
    ["firstName", "Suresh", "first_name", "Ravi"],
    // Earlier, not later: a DoJ after the stored salary_start_date (2026-01-01) is refused by
    // the SALARY_START_BEFORE_JOINING guard, which the test below covers.
    ["dateOfJoining", "2025-12-01", "date_of_joining", "2026-01-01"],
    ["dateOfBirth", "1995-03-15", "date_of_birth", "1990-01-01"],
    ["address1", "221B Baker Street", "address1", "Old Address"],
    ["city", "Bengaluru", "city", "Mumbai"],
  ])(
    "audits a %s change with before/after values",
    async (inputKey, newValue, dbCol, oldValue) => {
      exec.mockResolvedValueOnce([
        [{ ...fakeEmployee, [dbCol]: oldValue }],
        [],
      ]); // snapshot
      exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
      exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit log INSERT
      exec.mockResolvedValueOnce([
        [{ ...fakeEmployee, [dbCol]: newValue }],
        [],
      ]); // re-fetch

      await employeeService.updateEmployee(
        "emp-1",
        { [inputKey]: newValue } as any,
        "user-1",
      );

      const auditCall = exec.mock.calls.find(([sql]) =>
        /INSERT INTO sensitive_action_log/i.test(sql as string),
      );
      expect(
        auditCall,
        `expected an audit log write for ${inputKey}`,
      ).toBeTruthy();
      const params = auditCall![1] as unknown[];
      expect(params).toContain("EMPLOYEE_PROFILE_UPDATED");
      const paramsStr = JSON.stringify(params);
      expect(paramsStr).toContain(newValue);
      expect(paramsStr).toContain(oldValue);
    },
  );

  it("refuses a dateOfJoining after the stored salary_start_date, with no UPDATE and no audit row", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // snapshot: salary_start_date 2026-01-01
    await expect(
      employeeService.updateEmployee("emp-1", { dateOfJoining: "2026-05-01" }, "user-1"),
    ).rejects.toMatchObject({ statusCode: 400, code: "SALARY_START_BEFORE_JOINING" });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("audits an officialEmail change, on top of its separate auth_user.email sync", async () => {
    exec.mockResolvedValueOnce([
      [{ ...fakeEmployee, official_email: "ravi.old@mcn.com" }],
      [],
    ]); // snapshot
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE employees
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit log INSERT
    exec.mockResolvedValueOnce([[{ user_id: "user-1" }], []]); // SELECT employees.user_id (auth_user sync)
    exec.mockResolvedValueOnce([[], []]); // SELECT auth_user email conflict — none
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE auth_user
    exec.mockResolvedValueOnce([
      [{ ...fakeEmployee, official_email: "suresh@mcn.com" }],
      [],
    ]); // re-fetch

    await employeeService.updateEmployee(
      "emp-1",
      { officialEmail: "suresh@mcn.com" },
      "user-1",
    );

    const auditCall = exec.mock.calls.find(([sql]) =>
      /INSERT INTO sensitive_action_log/i.test(sql as string),
    );
    expect(auditCall).toBeTruthy();
    const paramsStr = JSON.stringify(auditCall![1]);
    expect(paramsStr).toContain("suresh@mcn.com");
    expect(paramsStr).toContain("ravi.old@mcn.com");
  });

  it("does not audit an unchanged sensitive field re-sent with the same value", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // snapshot: mobile = "9999999999"
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // re-fetch (no audit INSERT in between)

    await employeeService.updateEmployee(
      "emp-1",
      { mobile: "9999999999" },
      "user-1",
    );

    expect(
      exec.mock.calls.some(([sql]) =>
        /INSERT INTO sensitive_action_log/i.test(sql as string),
      ),
    ).toBe(false);
  });
});

// ─── Deactivate ───────────────────────────────────────────────────────────────

describe("employeeService.deactivateEmployee", () => {
  it("soft-deletes by setting active_status = 0", async () => {
    exec.mockResolvedValueOnce([[fakeEmployee], []]); // getEmployee
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    await employeeService.deactivateEmployee(
      "emp-1",
      "user-1",
      "Role ended by HR",
    );
    const updateCall = exec.mock.calls[1][0] as string;
    expect(updateCall).toContain("active_status");
  });
});

// ─── Auto-assign salary at creation ──────────────────────────────────────────

describe("employeeService.createEmployee with structureId + ctcAnnual", () => {
  it("auto-assigns salary when structureId and ctcAnnual provided", async () => {
    mockCreateFlow(fakeEmployee);
    const r = await employeeService.createEmployee({
      employeeCode: "MCN003",
      firstName: "Amit",
      dateOfJoining: "2026-06-01",
      structureId: "550e8400-e29b-41d4-a716-446655440001",
      ctcAnnual: 300000,
    }, "user-1");
    expect(r.employee_code).toBe("MCN001");
    const assignment = exec.mock.calls.find(([sql]) => /INSERT INTO employee_salary_assignment/i.test(sql as string));
    expect(assignment, "expected a salary assignment").toBeTruthy();
    // structure, CTC, and effective_from = date of joining (no explicit salary start date).
    expect((assignment![1] as unknown[]).slice(2)).toEqual(["550e8400-e29b-41d4-a716-446655440001", 300000, "2026-06-01"]);
    // employee_journey_log is no longer written here. Journey events moved to
    // journeyLog.service.appendJourneyEvent, which employee-creation-orchestrator
    // calls on the ATS candidate-conversion path. employeeService.createEmployee
    // is the direct-API path and does not log one, so asserting it here tested a
    // responsibility this unit no longer has.
    expect(
      exec.mock.calls.some(([sql]) =>
        /INSERT INTO employee_journey_log/i.test(sql as string),
      ),
    ).toBe(false);
  });

  it("skips salary assignment when structureId not provided", async () => {
    mockCreateFlow(fakeEmployee);
    await employeeService.createEmployee({
      employeeCode: "MCN004",
      firstName: "Neha",
      dateOfJoining: "2026-06-01",
    }, "user-1");
    expect(exec.mock.calls.some(([sql]) => /INSERT INTO employee_salary_assignment/i.test(sql as string))).toBe(false);
    // employee_journey_log is no longer written here. Journey events moved to
    // journeyLog.service.appendJourneyEvent, which employee-creation-orchestrator
    // calls on the ATS candidate-conversion path. employeeService.createEmployee
    // is the direct-API path and does not log one, so asserting it here tested a
    // responsibility this unit no longer has.
    expect(
      exec.mock.calls.some(([sql]) =>
        /INSERT INTO employee_journey_log/i.test(sql as string),
      ),
    ).toBe(false);
  });
});
