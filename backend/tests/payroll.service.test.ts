import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
    getConnection: vi.fn(),
  },
  pingDb: vi.fn(),
}));
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { db } from "../src/db/mysql.js";
import { payrollService } from "../src/modules/payroll/payroll.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;
const getConnection = db.getConnection as ReturnType<typeof vi.fn>;
const txExecute = vi.fn();
const beginTransaction = vi.fn();
const commit = vi.fn();
const rollback = vi.fn();
const release = vi.fn();

const fakeStructure = { id: "str-1", structure_code: "BPO_A", structure_name: "BPO Grade A", basic_pct: 40, hra_pct: 20, active_status: 1 };
const fakeComponent = { id: "cmp-1", component_code: "BASIC", component_name: "Basic Salary", component_type: "earning", taxable: 1, active_status: 1 };
const fakeAssignment = { id: "asgn-1", employee_id: "emp-1", structure_id: "str-1", ctc_annual: 300000, effective_from: "2026-01-01", active_status: 1 };
const fakeRun = { id: "run-1", run_month: "2026-05", status: "draft", total_employees: 0, total_gross: 0, total_net: 0 };
const fakeLine = { id: "line-1", run_id: "run-1", employee_id: "emp-1", employee_code: "MCN001", gross_salary: 25000, net_salary: 22000, status: "draft" };
const fakeAdvance = { id: "adv-1", employee_id: "emp-1", amount: 5000, status: "active" };

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockReset().mockResolvedValue([[], []]);
  txExecute.mockReset().mockResolvedValue([{ affectedRows: 1 }, []]);
  beginTransaction.mockReset().mockResolvedValue(undefined);
  commit.mockReset().mockResolvedValue(undefined);
  rollback.mockReset().mockResolvedValue(undefined);
  release.mockReset();
  getConnection.mockReset().mockResolvedValue({
    execute: txExecute,
    beginTransaction,
    commit,
    rollback,
    release,
  });
});

// ─── Structures ──────────────────────────────────────────────────────────────

describe("payrollService.listStructures", () => {
  it("returns structures", async () => {
    exec.mockResolvedValueOnce([[fakeStructure], []]);
    const r = await payrollService.listStructures();
    expect(r[0].structure_code).toBe("BPO_A");
  });
});

describe("payrollService.createStructure", () => {
  it("throws on duplicate code", async () => {
    exec.mockResolvedValueOnce([[fakeStructure], []]);
    await expect(payrollService.createStructure({ structureCode: "BPO_A", structureName: "X" }, "user-1"))
      .rejects.toThrow("Structure code already exists");
  });

  it("creates structure with basicPct and hraPct", async () => {
    exec.mockResolvedValueOnce([[], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeStructure], []]);
    const r = await payrollService.createStructure({
      structureCode: "BPO_A", structureName: "BPO Grade A", basicPct: 40, hraPct: 20,
    }, "user-1");
    expect(r.structure_code).toBe("BPO_A");
    expect(r.basic_pct).toBe(40);
    expect(r.hra_pct).toBe(20);
  });

  it("creates structure with default basicPct=40 hraPct=20 when omitted", async () => {
    exec.mockResolvedValueOnce([[], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeStructure], []]);
    const r = await payrollService.createStructure({ structureCode: "BPO_A", structureName: "BPO Grade A" }, "user-1");
    // verify INSERT was called with defaults
    const insertSql = exec.mock.calls[1][0] as string;
    expect(insertSql).toContain("basic_pct");
    expect(r.basic_pct).toBe(40);
  });
});

// ─── Bulk assign ──────────────────────────────────────────────────────────────

describe("payrollService.bulkAssignSalary", () => {
  const fakeEmp1 = { id: "emp-1", employee_code: "MCN001" };
  const fakeEmp2 = { id: "emp-2", employee_code: "MCN002" };

  it("assigns salary to all matching unassigned employees", async () => {
    exec.mockResolvedValueOnce([[fakeStructure], []]);       // getStructure
    exec.mockResolvedValueOnce([[fakeEmp1, fakeEmp2], []]); // find employees
    exec.mockResolvedValueOnce([{ affectedRows: 2 }, []]);  // deactivate old
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // INSERT emp-1
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // INSERT emp-2
    const r = await payrollService.bulkAssignSalary({
      structureId: "str-1",
      ctcAnnual: 300000,
      effectiveFrom: "2026-01-01",
    }, "user-1");
    expect(r.assigned).toBe(2);
    expect(r.skipped).toBe(0);
  });

  it("throws when structure not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(payrollService.bulkAssignSalary({
      structureId: "nope",
      ctcAnnual: 300000,
      effectiveFrom: "2026-01-01",
    }, "user-1")).rejects.toThrow("Structure not found");
  });

  it("filters by processId when provided", async () => {
    exec.mockResolvedValueOnce([[fakeStructure], []]);
    exec.mockResolvedValueOnce([[fakeEmp1], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await payrollService.bulkAssignSalary({
      structureId: "str-1", ctcAnnual: 300000, effectiveFrom: "2026-01-01", processId: "proc-1",
    }, "user-1");
    const empQuery = exec.mock.calls[1][0] as string;
    expect(empQuery).toContain("process_id");
  });
});

// ─── Components ──────────────────────────────────────────────────────────────

describe("payrollService.listComponents", () => {
  it("returns components", async () => {
    exec.mockResolvedValueOnce([[fakeComponent], []]);
    const r = await payrollService.listComponents();
    expect(r[0].component_code).toBe("BASIC");
  });
});

// ─── Salary Assignment ────────────────────────────────────────────────────────

describe("payrollService.assignSalary", () => {
  it("deactivates old assignment and creates new", async () => {
    exec.mockResolvedValueOnce([[fakeStructure], []]); // validate structure
    exec.mockResolvedValueOnce([[], []]); // no previous assignment
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // journey INSERT
    exec.mockResolvedValueOnce([[], []]); // journey re-fetch
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // sensitive audit INSERT
    exec.mockResolvedValueOnce([[fakeAssignment], []]); // assignment re-fetch
    const r = await payrollService.assignSalary({
      employeeId: "emp-1",
      structureId: "str-1",
      ctcAnnual: 300000,
      effectiveFrom: "2026-01-01",
    }, "user-1");
    expect(r.ctc_annual).toBe(300000);
    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(txExecute).toHaveBeenCalledTimes(3);
    expect(txExecute.mock.calls.some(([sql]) => /UPDATE employees SET ctc/i.test(sql))).toBe(true);
  });
});

describe("payrollService.getEmployeeSalary", () => {
  it("returns active assignment", async () => {
    exec.mockResolvedValueOnce([[fakeAssignment], []]);
    const r = await payrollService.getEmployeeSalary("emp-1");
    expect(r?.employee_id).toBe("emp-1");
  });

  it("returns null when no assignment", async () => {
    exec.mockResolvedValueOnce([[], []]);
    const r = await payrollService.getEmployeeSalary("emp-1");
    expect(r).toBeNull();
  });
});

// ─── Prep Runs ────────────────────────────────────────────────────────────────

describe("payrollService.createRun", () => {
  it("throws when run already exists for that month+branch+process", async () => {
    exec.mockResolvedValueOnce([[fakeRun], []]);
    await expect(payrollService.createRun({ runMonth: "2026-05" }, "user-1"))
      .rejects.toThrow("Payroll run already exists");
  });

  it("creates run", async () => {
    exec.mockResolvedValueOnce([[], []]);
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeRun], []]);
    const r = await payrollService.createRun({ runMonth: "2026-05" }, "user-1");
    expect(r.run_month).toBe("2026-05");
    expect(r.status).toBe("draft");
  });
});

describe("payrollService.getRun", () => {
  it("returns run", async () => {
    exec.mockResolvedValueOnce([[fakeRun], []]);
    const r = await payrollService.getRun("run-1");
    expect(r.id).toBe("run-1");
  });
  it("throws when not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(payrollService.getRun("nope")).rejects.toThrow("Payroll run not found");
  });
});

describe("payrollService.updateRunStatus", () => {
  it("advances run status", async () => {
    exec.mockResolvedValueOnce([[fakeRun], []]); // getRun
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    exec.mockResolvedValueOnce([[{ ...fakeRun, status: "approved" }], []]); // re-fetch
    const r = await payrollService.updateRunStatus("run-1", { status: "approved" }, "user-1");
    expect(r.status).toBe("approved");
  });

  it("throws when disbursed run tries to change status", async () => {
    exec.mockResolvedValueOnce([[{ ...fakeRun, status: "disbursed" }], []]);
    await expect(payrollService.updateRunStatus("run-1", { status: "locked" }, "user-1"))
      .rejects.toThrow("disbursed");
  });
});

describe("payrollService.listRuns", () => {
  it("returns paginated runs", async () => {
    exec.mockResolvedValueOnce([[fakeRun], []]);
    exec.mockResolvedValueOnce([[{ total: 1 }], []]);
    const r = await payrollService.listRuns({ page: 1, limit: 50 });
    expect(r.data).toHaveLength(1);
    expect(r.total).toBe(1);
  });
});

// ─── Prep Lines ───────────────────────────────────────────────────────────────

describe("payrollService.listLines", () => {
  it("returns lines for a run", async () => {
    exec.mockResolvedValueOnce([[fakeLine], []]);
    const r = await payrollService.listLines("run-1");
    expect(r[0].employee_code).toBe("MCN001");
  });
});

describe("payrollService.updateLine", () => {
  it("updates prep line", async () => {
    exec.mockResolvedValueOnce([[fakeLine], []]); // get
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    exec.mockResolvedValueOnce([[{ ...fakeLine, lwp_days: 2 }], []]); // re-fetch
    const r = await payrollService.updateLine("line-1", { lwpDays: 2 }, "user-1");
    expect(r.lwp_days).toBe(2);
  });

  it("throws when line not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(payrollService.updateLine("nope", {}, "user-1")).rejects.toThrow("Prep line not found");
  });
});

// ─── Advances ────────────────────────────────────────────────────────────────

describe("payrollService.createAdvance", () => {
  it("creates advance", async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    exec.mockResolvedValueOnce([[fakeAdvance], []]);
    const r = await payrollService.createAdvance({
      employeeId: "emp-1", amount: 5000, advanceDate: "2026-05-01", recoveryMonths: 1,
    }, "user-1");
    expect(r.amount).toBe(5000);
  });
});

describe("payrollService.listAdvances", () => {
  it("returns advances for employee", async () => {
    exec.mockResolvedValueOnce([[fakeAdvance], []]);
    const r = await payrollService.listAdvances("emp-1");
    expect(r).toHaveLength(1);
  });
});

// ─── Statutory Config ─────────────────────────────────────────────────────────

describe("payrollService.getStatutoryConfig", () => {
  it("returns config as key-value map", async () => {
    exec.mockResolvedValueOnce([[
      { config_key: "PF_EMPLOYEE_PCT", config_value: 12 },
      { config_key: "ESIC_WAGE_LIMIT", config_value: 21000 },
    ], []]);
    const r = await payrollService.getStatutoryConfig();
    expect(r["PF_EMPLOYEE_PCT"]).toBe(12);
    expect(r["ESIC_WAGE_LIMIT"]).toBe(21000);
  });
});

// ─── Salary Calculation ───────────────────────────────────────────────────────

// Standard Indian CTC: Basic 40%, HRA 20%, Special Allowance = remainder
// PF applies on Basic (not gross), capped at pfWageLimit
// ESIC applies on gross when gross <= esicWageLimit

const baseParams = {
  grossMonthlyCTC: 25000,
  workingDays: 26,
  lwpDays: 0,
  pfEmployeePct: 12,
  esicEmployeePct: 0.75,
  esicWageLimit: 21000,
  pfWageLimit: 15000,
  professionalTax: 200,
  tds: 0,
  basicPct: 40,
  hraPct: 20,
};

describe("payrollService.calculateNetSalary", () => {
  it("returns salary breakdown with Basic, HRA, Special Allowance", () => {
    const result = payrollService.calculateNetSalary(baseParams);
    expect(result.basic).toBe(10000);          // 40% of 25000
    expect(result.hra).toBe(5000);             // 20% of 25000
    expect(result.special_allowance).toBe(10000); // 25000 - 10000 - 5000
    expect(result.gross_salary).toBe(25000);
  });

  it("calculates PF on Basic, not gross", () => {
    // Basic = 10000, pfWageLimit = 15000 → pfBase = min(10000, 15000) = 10000
    // PF employee = 12% of 10000 = 1200
    const result = payrollService.calculateNetSalary(baseParams);
    expect(result.pf_employee).toBeCloseTo(1200, 1);
  });

  it("caps PF base at pfWageLimit when Basic > pfWageLimit", () => {
    // Basic = 40% of 50000 = 20000, pfWageLimit = 15000 → pfBase = 15000
    // PF employee = 12% of 15000 = 1800
    const result = payrollService.calculateNetSalary({
      ...baseParams,
      grossMonthlyCTC: 50000,
      pfWageLimit: 15000,
    });
    expect(result.pf_employee).toBeCloseTo(1800, 1);
  });

  it("splits employer PF into EPF contribution (3.67%) and EPS (8.33%)", () => {
    // Basic = 10000, pfBase = 10000
    // EPF employer = 3.67% of 10000 = 367
    // EPS = 8.33% of min(Basic, 15000) = 833
    const result = payrollService.calculateNetSalary(baseParams);
    expect(result.pf_employer_epf).toBeCloseTo(367, 0);
    expect(result.pf_employer_eps).toBeCloseTo(833, 0);
    expect(result.pf_employer).toBeCloseTo(1200, 0); // total employer PF
  });

  it("calculates gratuity as 4.81% of Basic", () => {
    // Basic = 10000, gratuity = 4.81% of 10000 = 481
    const result = payrollService.calculateNetSalary(baseParams);
    expect(result.gratuity).toBeCloseTo(481, 0);
  });

  it("applies LWP deduction proportionally across all components", () => {
    // 2 LWP out of 26 days → earn 24/26 of each component
    const result = payrollService.calculateNetSalary({ ...baseParams, grossMonthlyCTC: 26000, lwpDays: 2 });
    const ratio = 24 / 26;
    expect(result.basic).toBeCloseTo(Math.round(10400 * ratio * 100) / 100, 0);
    expect(result.gross_salary).toBeCloseTo(Math.round(26000 * ratio * 100) / 100, 0);
  });

  it("applies ESIC on gross when gross <= esicWageLimit", () => {
    // gross = 20000 <= 21000 → ESIC employee = 0.75% of 20000 = 150
    const result = payrollService.calculateNetSalary({ ...baseParams, grossMonthlyCTC: 20000 });
    expect(result.esic_employee).toBeCloseTo(150, 1);
    expect(result.esic_employer).toBeCloseTo(Math.round(20000 * 0.0325 * 100) / 100, 1);
  });

  it("skips ESIC when gross > esicWageLimit", () => {
    const result = payrollService.calculateNetSalary({ ...baseParams, grossMonthlyCTC: 30000 });
    expect(result.esic_employee).toBe(0);
    expect(result.esic_employer).toBe(0);
  });

  it("net_salary = gross - employee deductions only (PF emp + ESIC emp + PT + TDS)", () => {
    const result = payrollService.calculateNetSalary(baseParams);
    const expectedNet = Math.round(
      (result.gross_salary - result.pf_employee - result.esic_employee - result.professional_tax - result.tds) * 100
    ) / 100;
    expect(result.net_salary).toBeCloseTo(expectedNet, 1);
  });

  it("full CTC = gross + employer PF + employer ESIC + gratuity", () => {
    const result = payrollService.calculateNetSalary(baseParams);
    const expectedCTC = Math.round(
      (result.gross_salary + result.pf_employer + result.esic_employer + result.gratuity) * 100
    ) / 100;
    expect(result.ctc_monthly).toBeCloseTo(expectedCTC, 0);
  });

  it("adds variable allowances (night shift, incentive) to gross", () => {
    const result = payrollService.calculateNetSalary({
      ...baseParams,
      allowances: [
        { name: "Night Shift Allowance", amount: 2000 },
        { name: "Incentive", amount: 3000 },
      ],
    });
    expect(result.gross_salary).toBeCloseTo(25000 + 2000 + 3000, 0);
    expect(result.allowances_total).toBe(5000);
  });

  it("variable allowances do not change PF base (PF stays on Basic only)", () => {
    const withoutAllowances = payrollService.calculateNetSalary(baseParams);
    const withAllowances = payrollService.calculateNetSalary({
      ...baseParams,
      allowances: [{ name: "Incentive", amount: 10000 }],
    });
    expect(withAllowances.pf_employee).toBeCloseTo(withoutAllowances.pf_employee, 1);
  });

  it("ESIC eligibility rechecked after adding allowances — skips when total gross > esicWageLimit", () => {
    // Base gross = 20000 (within ESIC limit), add 2000 allowance → 22000 > 21000 → no ESIC
    const result = payrollService.calculateNetSalary({
      ...baseParams,
      grossMonthlyCTC: 20000,
      allowances: [{ name: "Night Shift Allowance", amount: 2000 }],
    });
    expect(result.esic_employee).toBe(0);
    expect(result.esic_employer).toBe(0);
  });

  it("variable allowances breakdown listed in result", () => {
    const result = payrollService.calculateNetSalary({
      ...baseParams,
      allowances: [
        { name: "Night Shift Allowance", amount: 1500 },
        { name: "Performance Incentive", amount: 2500 },
      ],
    });
    expect(result.allowances).toHaveLength(2);
    expect(result.allowances[0].name).toBe("Night Shift Allowance");
    expect(result.allowances[1].amount).toBe(2500);
  });
});
