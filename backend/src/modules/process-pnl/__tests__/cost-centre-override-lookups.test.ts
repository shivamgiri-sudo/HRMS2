import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn(async () => true) }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));

import { listOverrideCostCentreOptions, searchEmployeesForOverride } from "../pnl-cost-centre-override.service.js";

describe("cost-centre mapping lookups", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue([[]]);
  });

  it("lists only open cost centres, unpaginated, narrowed to the branch when one is given", async () => {
    execute.mockResolvedValue([[{ id: "c1", cost_centre_code: "BSS/OB/AHMH-JD/465", cost_centre_name: "465", branch_id: "b1", branch_name: "AHMEDABAD-JALDARSHAN", process_name: "Godfrey" }]]);
    const options = await listOverrideCostCentreOptions("b1");
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("cc.active_status = 1");
    expect(sql).toContain("COALESCE(bm.active_status, 1) = 1");
    expect(sql).toContain("cc.branch_id = ?");
    expect(sql).not.toMatch(/LIMIT (50|100)\b/);
    expect(params).toEqual(["b1"]);
    expect(options[0]).toMatchObject({ code: "BSS/OB/AHMH-JD/465", branchName: "AHMEDABAD-JALDARSHAN" });
  });

  it("lists every branch when no branch is chosen", async () => {
    await listOverrideCostCentreOptions(null);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).not.toContain("cc.branch_id = ?");
    expect(params).toEqual([]);
  });

  it("does not query for a search shorter than two characters", async () => {
    expect(await searchEmployeesForOverride("M")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("searches active employees by code or name and returns the name", async () => {
    execute.mockResolvedValue([[{ id: "e1", employee_code: "MAS59568", name: "VACHHER MANISH NARESHKUMAR", branch_name: "AHMEDABAD-JALDARSHAN", cost_centre_code: "BSS/OB/AHMH-JD/465", already_mapped_to: null }]]);
    const found = await searchEmployeesForOverride("vachher");
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("e.active_status = 1");
    expect(params.slice(0, 2)).toEqual(["%vachher%", "%vachher%"]);
    expect(found).toEqual([{ id: "e1", employeeCode: "MAS59568", name: "VACHHER MANISH NARESHKUMAR", branchName: "AHMEDABAD-JALDARSHAN", costCentreCode: "BSS/OB/AHMH-JD/465", alreadyMappedTo: null }]);
  });
});
