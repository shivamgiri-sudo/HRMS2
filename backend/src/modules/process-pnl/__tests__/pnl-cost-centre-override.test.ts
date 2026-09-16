import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-employee cost centre override for P&L attribution (migration 1785).
 *
 * Business case under test: BSS/BO/NOIDA-2/577 is a back-office pool that works entirely on the
 * BSS/BO/NOIDA-2/576 (Onfido) account. This service lets Finance redirect a batch of employees'
 * pay to a different cost centre for P&L reporting only, without ever writing employees.cost_centre_id.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
const writeAuditLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog }));

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  writeAuditLog.mockClear();
  tableExists.mockResolvedValue(true);
});

describe("overrideJoinSql", () => {
  it("falls back to the bare column, no join, when the table has not been migrated yet", async () => {
    tableExists.mockResolvedValue(false);
    const { overrideJoinSql } = await import("../pnl-cost-centre-override.service.js");
    const out = await overrideJoinSql("e.id", "e.cost_centre_id");
    expect(out.join).toBe("");
    expect(out.effectiveCostCentreExpr).toBe("e.cost_centre_id");
  });

  it("returns a LEFT JOIN + COALESCE against the fallback column once migrated", async () => {
    tableExists.mockResolvedValue(true);
    const { overrideJoinSql } = await import("../pnl-cost-centre-override.service.js");
    const out = await overrideJoinSql("e.id", "e.cost_centre_id");
    expect(out.join).toContain("LEFT JOIN pnl_employee_cost_centre_override pecco");
    expect(out.join).toContain("pecco.employee_id = e.id");
    expect(out.join).toContain("pecco.active_status = 1");
    expect(out.effectiveCostCentreExpr).toBe("COALESCE(pecco.target_cost_centre_id, e.cost_centre_id)");
  });

  it("keys the join on a snapshot table's own employee_id column when there is no employees join", async () => {
    const { overrideJoinSql } = await import("../pnl-cost-centre-override.service.js");
    const out = await overrideJoinSql("s.employee_id", "s.cost_centre_id");
    expect(out.join).toContain("pecco.employee_id = s.employee_id");
    expect(out.effectiveCostCentreExpr).toBe("COALESCE(pecco.target_cost_centre_id, s.cost_centre_id)");
  });
});

describe("bulkSetCostCentreOverride", () => {
  function mockHappyPath() {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM cost_centre_master WHERE id = ?")) return [[{ id: "cc-576" }], []];
      if (q.includes("FROM employees WHERE employee_code IN")) {
        return [[
          { id: "emp-1", employee_code: "MAS001", name: "Alpha One" },
          { id: "emp-2", employee_code: "MAS002", name: "Beta Two" },
        ], []];
      }
      if (q.includes("INSERT INTO pnl_employee_cost_centre_override")) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
  }

  it("resolves pasted employee codes, upserts one row per employee, and reports unknown codes", async () => {
    mockHappyPath();
    const { bulkSetCostCentreOverride } = await import("../pnl-cost-centre-override.service.js");
    const result = await bulkSetCostCentreOverride(
      { employeeCodes: ["MAS001", "MAS002", "MAS999"], targetCostCentreId: "cc-576", reason: "Onfido back office" },
      "actor-1",
    );
    expect(result.applied.map((a) => a.employeeCode).sort()).toEqual(["MAS001", "MAS002"]);
    expect(result.notFound).toEqual(["MAS999"]);

    const inserts = execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO pnl_employee_cost_centre_override"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toContain("cc-576");
    expect(String(inserts[0][0])).toContain("ON DUPLICATE KEY UPDATE");
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates repeated codes in the same paste instead of writing twice", async () => {
    mockHappyPath();
    const { bulkSetCostCentreOverride } = await import("../pnl-cost-centre-override.service.js");
    const result = await bulkSetCostCentreOverride(
      { employeeCodes: ["MAS001", "MAS001", " MAS001 "], targetCostCentreId: "cc-576" },
      "actor-1",
    );
    expect(result.applied).toHaveLength(1);
    const inserts = execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO pnl_employee_cost_centre_override"));
    expect(inserts).toHaveLength(1);
  });

  it("refuses with 503 when the table has not been migrated yet", async () => {
    tableExists.mockResolvedValue(false);
    const { bulkSetCostCentreOverride } = await import("../pnl-cost-centre-override.service.js");
    await expect(
      bulkSetCostCentreOverride({ employeeCodes: ["MAS001"], targetCostCentreId: "cc-576" }, "actor-1"),
    ).rejects.toMatchObject({ code: "PNL_CC_OVERRIDE_TABLE_MISSING" });
  });

  it("refuses when the target cost centre does not exist — never silently maps to nothing", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM cost_centre_master WHERE id = ?")) return [[], []];
      return [[], []];
    });
    const { bulkSetCostCentreOverride } = await import("../pnl-cost-centre-override.service.js");
    await expect(
      bulkSetCostCentreOverride({ employeeCodes: ["MAS001"], targetCostCentreId: "cc-missing" }, "actor-1"),
    ).rejects.toMatchObject({ code: "PNL_CC_OVERRIDE_TARGET_NOT_FOUND" });
  });

  it("refuses an empty paste rather than issuing a no-op write", async () => {
    const { bulkSetCostCentreOverride } = await import("../pnl-cost-centre-override.service.js");
    await expect(
      bulkSetCostCentreOverride({ employeeCodes: ["   ", ""], targetCostCentreId: "cc-576" }, "actor-1"),
    ).rejects.toMatchObject({ code: "PNL_CC_OVERRIDE_NO_CODES" });
  });
});

describe("deactivateCostCentreOverride", () => {
  it("reverts one employee to their real cost centre and audits it", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const { deactivateCostCentreOverride } = await import("../pnl-cost-centre-override.service.js");
    await deactivateCostCentreOverride("emp-1", "actor-1");
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("SET active_status = 0");
    expect(params).toEqual(["actor-1", "emp-1"]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "PNL_COST_CENTRE_OVERRIDE_DEACTIVATED",
      entity_id: "emp-1",
    }));
  });

  it("refuses 404 when the employee has no active override to deactivate", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    const { deactivateCostCentreOverride } = await import("../pnl-cost-centre-override.service.js");
    await expect(deactivateCostCentreOverride("emp-2", "actor-1")).rejects.toMatchObject({
      code: "PNL_CC_OVERRIDE_NOT_FOUND",
    });
  });
});

describe("listCostCentreOverrides", () => {
  it("maps rows including actual vs target cost centre labels", async () => {
    execute.mockResolvedValueOnce([[
      {
        id: "ov-1", employee_id: "emp-1", employee_code: "MAS001", employee_name: "Alpha One",
        actual_cost_centre_id: "cc-577", actual_cost_centre_code: "BSS/BO/NOIDA-2/577", actual_cost_centre_name: "Back Office",
        target_cost_centre_id: "cc-576", target_cost_centre_code: "BSS/BO/NOIDA-2/576", target_cost_centre_name: "Onfido",
        reason: "Onfido back office", active_status: 1, created_by: "actor-1", created_by_name: "Finance User",
        created_at: "2026-09-16 10:00:00", updated_at: "2026-09-16 10:00:00",
      },
    ], []]);
    const { listCostCentreOverrides } = await import("../pnl-cost-centre-override.service.js");
    const rows = await listCostCentreOverrides();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      employeeCode: "MAS001",
      actualCostCentreCode: "BSS/BO/NOIDA-2/577",
      targetCostCentreCode: "BSS/BO/NOIDA-2/576",
      activeStatus: true,
    });
  });

  it("returns an empty list before the table has been migrated, rather than throwing", async () => {
    tableExists.mockResolvedValue(false);
    const { listCostCentreOverrides } = await import("../pnl-cost-centre-override.service.js");
    expect(await listCostCentreOverrides()).toEqual([]);
  });
});
