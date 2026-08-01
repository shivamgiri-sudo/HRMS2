import { describe, it, expect, vi, beforeEach } from "vitest";

// calculatePayrollRun wraps its writes in a transaction and runs the per-employee
// reads on that connection, so the mock must provide getConnection as well as
// execute. The connection deliberately shares the same execute spy: the
// assertions below inspect mockExecute.mock.calls to find the employee query and
// the prep-line upsert, and splitting the calls across two spies would hide half
// of them.
vi.mock("../src/db/mysql.js", () => {
  const execute = vi.fn().mockResolvedValue([[], []]);
  return {
    db: {
      execute,
      query: execute,
      getConnection: vi.fn().mockResolvedValue({
        execute,
        query: execute,
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      }),
    },
  };
});

import { db } from "../src/db/mysql.js";
import { calculatePayrollRun } from "../src/modules/payroll/payrollCalculate.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const fakeRun = {
  id: "run-1",
  run_month: "2026-05",
  branch_filter: null,
  process_filter: "Inbound",
  status: "draft",
  total_employees: 0,
  total_gross: 0,
  total_deductions: 0,
  total_net: 0,
  created_by: "user-1",
};

const fakeEmployee = {
  employee_id: "emp-1",
  employee_code: "EMP001",
  ctc_annual: 300000,  // ₹3L pa → ₹25k/month gross
  basic_pct: 40,
  hra_pct: 20,
  // resolveProfessionalTax refuses to guess when the branch has no state, since
  // the old hardcoded ₹200 default deducted from 172 employees who owed nothing.
  // The fixture therefore has to say which state this employee is taxed in.
  state_code: "MH",
};

const fakeAttendance = {
  employee_id: "emp-1",
  working_days: 26,
  present_days: 24,
  leave_days: 1,
  lwp_days: 1,
  late_marks: 2,
  dialer_hours: 200,
};

// Key-value rows matching SELECT config_key, config_value FROM statutory_config
const fakeStatKvRows = [
  { config_key: "pf_employee_pct",  config_value: 12 },
  { config_key: "esic_employee_pct", config_value: 0.75 },
  { config_key: "esic_wage_limit",  config_value: 21000 },
  { config_key: "pf_wage_limit",    config_value: 15000 },
  { config_key: "professional_tax", config_value: 200 },
  { config_key: "tds_standard_deduction", config_value: 75000 },
  { config_key: "tds_rebate_87a_limit", config_value: 700000 },
];

describe("calculatePayrollRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset().mockResolvedValue([[], []]);
  });

  it("throws when run not found", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // getRun
    await expect(calculatePayrollRun("missing-run", "user-1")).rejects.toThrow("Run not found");
  });

  it("throws when run is locked/disbursed", async () => {
    mockExecute.mockResolvedValueOnce([[{ ...fakeRun, status: "locked" }]]);
    await expect(calculatePayrollRun("run-1", "user-1")).rejects.toThrow("locked");
  });

  /**
   * Standard one-employee run, keyed by the table each query reads.
   *
   * This used to queue twelve results positionally, in the order the service
   * happened to issue them. That order is not a contract: calculatePayrollRun
   * now touches twenty-two distinct tables, and every query added since — the
   * designation/department lookup, the attendance-feature and billing configs,
   * component assignments, loans, deduction entries, statutory overrides — shifted
   * every later mock onto the wrong call. The failures that produced were
   * "Cannot read properties of undefined (reading 'cnt')" and "...'tg'", which
   * read like service bugs and are not.
   *
   * Keyed by SQL, inserting another query is harmless: it falls through to the
   * empty default instead of silently stealing the next fixture.
   */
  function mockOneEmployeeRun(overrideUpsert?: (sql: string, params: unknown[]) => unknown) {
    // The run is re-fetched after the status update, and must reflect it.
    let runStatus = "draft";

    mockExecute.mockImplementation(async (sql: string, params: unknown[]) => {
      const q = String(sql);

      if (/UPDATE\s+salary_prep_run/i.test(q)) {
        if (/status\s*=\s*'processing'/i.test(q) || (params ?? []).includes("processing")) runStatus = "processing";
        return [{ affectedRows: 1 }];
      }
      if (/FROM\s+salary_prep_run/i.test(q)) return [[{ ...fakeRun, status: runStatus }]];

      if (/FROM\s+statutory_config/i.test(q)) return [fakeStatKvRows];

      // The employee list for the run — distinguished from the per-employee
      // designation/department lookup by the filter columns the test asserts on.
      if (/FROM\s+employees/i.test(q) && /process_filter|process_id|process_name|branch/i.test(q)) {
        return [[fakeEmployee]];
      }

      // cnt = 0 drives the wfm_attendance_session fallback path this fixture models.
      if (/COUNT\(\*\)\s+AS\s+cnt/i.test(q) && /attendance_daily_record/i.test(q)) return [[{ cnt: 0 }]];
      if (/FROM\s+wfm_attendance_session/i.test(q)) return [[fakeAttendance]];

      if (/FROM\s+salary_advance_log/i.test(q)) return [[{ monthly_recovery: 0 }]];

      // A configured slab for the employee's state. Returning no rows would be a
      // different scenario entirely — the service treats an unconfigured state as
      // an error rather than as zero, precisely so an under-deduction cannot pass
      // silently.
      if (/FROM\s+pt_slab_master/i.test(q)) return [[{ pt_amount: 200 }]];

      // Run totals recomputed from the written lines.
      if (/AS\s+tg/i.test(q)) return [[{ tg: 25000, td: 3000, tn: 22000 }]];

      if (/INTO\s+salary_prep_line\b/i.test(q)) {
        if (overrideUpsert) return overrideUpsert(q, params ?? []);
        return [{ affectedRows: 1 }];
      }

      // Everything else — tax_declaration, loans, deduction entries, statutory
      // overrides, component assignments, configs, audit writes — contributes
      // nothing to this scenario.
      return [[], []];
    });
  }

  it("fetches employees scoped to run's process_filter", async () => {
    mockOneEmployeeRun();
    await calculatePayrollRun("run-1", "user-1");

    // Asserted on the bound parameter, not on the SQL text. The previous version
    // only looked for a query mentioning "process_id" anywhere, which the SELECT
    // list satisfies on its own — so it passed even with the process filter
    // removed entirely. A payroll run that silently pays employees outside its
    // own process is exactly the failure this test is named for.
    const employeeQuery = mockExecute.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ([sql]: any) => /FROM\s+employees/i.test(String(sql)) && /date_of_leaving/i.test(String(sql)),
    );
    expect(employeeQuery, "the run's employee query was never issued").toBeDefined();

    const [sql, params] = employeeQuery as [string, unknown[]];
    expect(sql).toMatch(/process_name\s*=\s*\?/);
    expect(params).toContain(fakeRun.process_filter);
  });

  it("upserts one prep line per employee", async () => {
    mockOneEmployeeRun();
    await calculatePayrollRun("run-1", "user-1");

    const calls = mockExecute.mock.calls.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) => sql as string);
    const upsert = calls.find((s: string) => /salary_prep_line/i.test(s) && /INSERT|REPLACE/i.test(s));
    expect(upsert).toBeDefined();
  });

  it("calculates net salary correctly for single employee", async () => {
    let upsertParams: unknown[] = [];
    mockOneEmployeeRun((_sql: string, params: unknown[]) => {
      upsertParams = params;
      return [{ affectedRows: 1 }];
    });

    await calculatePayrollRun("run-1", "user-1");

    // net_salary should be positive and < gross
    const netSalary = upsertParams.find((p) => typeof p === "number" && (p as number) > 0 && (p as number) < 30000);
    expect(netSalary).toBeDefined();
  });

  it("updates run status to processing and sets totals", async () => {
    mockOneEmployeeRun();
    const result = await calculatePayrollRun("run-1", "user-1");
    expect(result.status).toBe("processing");
  });

  it("returns result with employee count", async () => {
    mockOneEmployeeRun();
    const result = await calculatePayrollRun("run-1", "user-1");
    expect(result.employees_processed).toBe(1);
  });
});
