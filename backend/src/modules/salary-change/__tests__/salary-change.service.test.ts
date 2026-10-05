import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * New "Salary Change Center" module: Payroll Head changes an already-active employee's
 * salary directly (they're already the final approver — per explicit confirmation this takes
 * effect immediately, not through a second approval step). Verifies: the new package is
 * inserted active, the old one is superseded (never both active at once), the audit log table
 * records old→new + who requested/who submitted, and logSensitiveAction is called.
 */

const { execute, connExecute, conn, getConnection, getPackageById, logSensitiveAction } = vi.hoisted(() => {
  const connExecute = vi.fn();
  // The three critical writes (insert new, supersede old, change log) run on one pooled
  // connection inside a transaction since d3108e0c8, so a dropped connection cannot leave an
  // 'active' row without its supersede partner or its log entry.
  const conn = {
    execute: connExecute,
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(() => undefined),
  };
  return {
    execute: vi.fn(),
    connExecute,
    conn,
    getConnection: vi.fn(async () => conn),
    getPackageById: vi.fn(),
    logSensitiveAction: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({ getPackageById }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { changeSalary } from "../salary-change.service.js";

describe("changeSalary()", () => {
  beforeEach(() => {
    execute.mockReset(); connExecute.mockReset(); getPackageById.mockReset(); logSensitiveAction.mockClear();
    conn.beginTransaction.mockClear(); conn.commit.mockClear(); conn.rollback.mockClear(); conn.release.mockClear();
  });

  it("inserts the new active assignment, supersedes the old one, and writes the audit trail", async () => {
    // Pool reads, then the non-critical display sync that runs after the transaction commits.
    execute
      .mockResolvedValueOnce([[{ id: "e1" }]]) // employee active check
      .mockResolvedValueOnce([[{ id: "old-assign-1", ctc: 40000 }]]) // current active assignment
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]); // sync employee_salary_assignment
    // The transactional writes, in order, on the dedicated connection.
    connExecute
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]) // INSERT new assignment
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]) // UPDATE old -> superseded
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]); // INSERT employee_salary_change_log

    getPackageById.mockResolvedValueOnce({
      id: "pkg-1", basic: 25000, hra: 10000, conveyance: 1600, special_allowance: 3400,
      gross: 40000, epf_employee: 3000, esic_employee: 0, epf_employer: 3000, esic_employer: 0,
      ctc: 50000, net_in_hand: 37000,
    });

    await changeSalary({
      employeeId: "e1", packageId: "pkg-1", effectiveDate: "2026-09-01", actorRoles: ["payroll_head"], // historical date: run as an exempt role
      reason: "Annual increment", requestedByUserId: "req-1", requestedByName: "Manager X",
      actorUserId: "actor-1",
    });

    // All three writes happen inside one committed transaction, and the connection is returned.
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connExecute).toHaveBeenCalledTimes(3);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);

    const insertAssignmentCall = connExecute.mock.calls[0];
    expect(insertAssignmentCall[0]).toContain("INSERT INTO salary_component_assignments");
    expect(insertAssignmentCall[0]).toContain("'active'");
    // Every component the package carries is copied, so the row's parts add up to its gross.
    for (const col of ["bonus", "portfolio", "medical_allowance", "lta", "other_allowance", "pli", "pf_employee", "esic_employee"]) {
      expect(insertAssignmentCall[0]).toContain(col);
    }
    const placeholders = (String(insertAssignmentCall[0]).match(/\?/g) ?? []).length;
    expect(insertAssignmentCall[1]).toHaveLength(placeholders);

    const supersedeCall = connExecute.mock.calls[1];
    expect(supersedeCall[0]).toContain("status = 'superseded'");
    expect(supersedeCall[1]).toEqual(["old-assign-1"]);

    const logCall = connExecute.mock.calls[2];
    expect(logCall[0]).toContain("INSERT INTO employee_salary_change_log");
    expect(logCall[1]).toEqual(
      expect.arrayContaining(["e1", "old-assign-1", "req-1", "Manager X", "actor-1", "Annual increment", 40000, 50000, "2026-09-01"])
    );

    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "SALARY_CHANGED",
      module_key: "payroll",
      entity_id: "e1",
    }));
  });

  it("copies the bonus and every other component so the package row adds up to its gross (band G, gross 15,059)", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "e1" }]])
      .mockResolvedValueOnce([[{ id: "old-assign-1", ctc: 13000 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]);
    connExecute
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown])
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown])
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]);
    getPackageById.mockResolvedValueOnce({
      id: "pkg-g", basic: 8000, hra: 4793, conveyance: 1600, bonus: 666, special_allowance: 0,
      portfolio: 0, medical: 0, lta: 0, other_allowance: 0, pli: 0,
      gross: 15059, epf_employee: 960, esic_employee: 0, epf_employer: 960, esic_employer: 0, ctc: 16588, net_in_hand: 13986,
    });

    await changeSalary({
      employeeId: "e1", packageId: "pkg-g", effectiveDate: "2026-09-01", actorRoles: ["payroll_head"],
      reason: "Annual increment", requestedByUserId: "req-1", requestedByName: "Manager X", actorUserId: "actor-1",
    });

    const params = connExecute.mock.calls[0][1] as unknown[];
    // basic, hra, conveyance, special, bonus: the parts that make up the 15,059 gross
    expect(params).toEqual(expect.arrayContaining([8000, 4793, 1600, 666, 15059]));
    const sum = [8000, 4793, 1600, 666].reduce((a, b) => a + b, 0);
    expect(sum).toBe(15059);
    // employee statutory amounts travel with the package
    expect(params).toEqual(expect.arrayContaining([960]));
  });

  it("rejects a missing reason before touching the database write path", async () => {
    execute.mockResolvedValueOnce([[{ id: "e1" }]]);
    getPackageById.mockResolvedValueOnce({ id: "pkg-1" });

    await expect(changeSalary({
      employeeId: "e1", packageId: "pkg-1", effectiveDate: "2026-09-01", actorRoles: ["payroll_head"], // historical date: run as an exempt role
      reason: "   ", requestedByUserId: null, requestedByName: null, actorUserId: "actor-1",
    })).rejects.toThrow(/reason/i);
  });
});

describe("getEmployeeSalaryProfile()", () => {
  beforeEach(() => { execute.mockReset(); });
  const baseEmployee = { id: "e1", employee_code: "MAS60227", full_name: "X" };

  it("keeps the row's own bonus and portfolio and derives the estimates when the row has no catalog package", async () => {
    execute
      .mockResolvedValueOnce([[baseEmployee]])
      .mockResolvedValueOnce([[{
        id: "a1", package_id: null, gross: 26055, basic: 14000, hra: 7000, conveyance: 1600,
        bonus: 1166, portfolio: 2289, pf_applicable: 1, esi_applicable: 0, net_estimate: 4675, ctc: 27875, employer_pf: 0, pf_employee: 0,
      }]])
      .mockResolvedValueOnce([[]]);
    const { getEmployeeSalaryProfile } = await import("../salary-change.service.js");
    const out = await getEmployeeSalaryProfile("e1");
    const sc = out.salary_components as Record<string, number>;
    expect(sc.bonus).toBe(1166);
    expect(sc.portfolio).toBe(2289);
    expect(sc.net_in_hand).toBe(24375); // not the stored 4,675
    expect(sc.pf_employee).toBe(1680);
    expect(sc.ctc).toBe(27875);
    const sql = String(execute.mock.calls[1][0]);
    expect(sql).toMatch(/CASE WHEN COALESCE\(sca\.bonus, 0\)\s+> 0 THEN sca\.bonus/);
  });

  it("leaves a catalog-linked row's figures exactly as stored", async () => {
    execute
      .mockResolvedValueOnce([[baseEmployee]])
      .mockResolvedValueOnce([[{ id: "a2", package_id: "pkg-1", gross: 15059, basic: 8000, net_in_hand: 13986, ctc: 16588, pf_employee: 960 }]])
      .mockResolvedValueOnce([[]]);
    const { getEmployeeSalaryProfile } = await import("../salary-change.service.js");
    const sc = (await getEmployeeSalaryProfile("e1")).salary_components as Record<string, number>;
    expect(sc.net_in_hand).toBe(13986);
    expect(sc.ctc).toBe(16588);
  });
});
