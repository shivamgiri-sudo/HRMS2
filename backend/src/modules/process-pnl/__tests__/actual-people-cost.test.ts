import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * People cost read from actual payroll rather than the recomputed snapshot.
 *
 * WHY THIS CHANGED. pnl_running_salary_snapshot holds only the employees computeRunningSalary can
 * reproduce for a period. Against what payroll actually paid:
 *
 *   April  snapshot Rs 112.11 lakh   salary_prep_line Rs 221.65 lakh (1,085 people)
 *   June   snapshot Rs 141.23 lakh   salary_prep_line Rs 227.88 lakh (1,530 people)
 *
 * About half the wage bill was absent, and a missing cost does not show up as a gap — it shows up
 * as profit. June reported a 42.9% operating margin for a business that runs at 10-30%.
 *
 * These tests pin the two things that make the substitution safe: every paid person is counted,
 * and each lands in the same bucket the process-level engine would have put them in.
 */

const { execute, tableExists, queryRows } = vi.hoisted(() => ({
  execute: vi.fn(),
  tableExists: vi.fn(),
  queryRows: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists, queryRows }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));

const person = (over: Record<string, unknown> = {}) => ({
  employee_id: "e1", employee_code: "E1",
  process_id: "p1", branch_id: "b1",
  designation_id: "d1", designation_name: "EXECUTIVE",
  department_id: "dep1", department_name: "OPERATIONS",
  loaded_cost: 100_000,
  ...over,
});

/**
 * getPayrollPeople resolves its columns at runtime, so the mock answers in call order:
 * the run lookup, then listColumns x N, then the people query.
 */
function mockPayroll(people: Record<string, unknown>[]) {
  execute.mockReset();
  tableExists.mockReset();
  queryRows.mockReset();
  tableExists.mockResolvedValue(true);
  // Both listColumns() and safeRows() go through queryRows, and listColumns reads `column_name`.
  const columns = [
    "gross_salary", "pf_employer", "esic_employer",
    "process_id", "branch_id", "designation_id", "department_id",
  ].map((column_name) => ({ column_name }));
  queryRows.mockImplementation(async (sql: string) => {
    const text = String(sql);
    if (text.includes("information_schema.columns")) return columns;
    if (text.includes("FROM salary_prep_run")) return [{ id: "run-1" }];
    if (text.includes("salary_prep_line")) return people;
    return [];                                // no classification rules -> derived buckets
  });
}

/**
 * bpo-pnl.service.ts memoises resolved columns in a module-level `columnCache` Map, so
 * every test has to re-import the module to get a clean one — unlike the sibling tests
 * here, the dynamic import below is load-bearing and cannot be hoisted.
 *
 * That makes each test pay a full module transform, which under the whole-directory
 * parallel run exceeded the 5s default and failed as "Test timed out in 5000ms" while
 * passing in isolation. The work is real, not a hang; the default is simply too tight
 * for six sequential re-imports of a service this size under load.
 */
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => vi.resetModules());

describe("getActualPeopleCost", () => {
  it("counts every paid person, not only those the snapshot could recompute", async () => {
    mockPayroll([person({ employee_id: "e1" }), person({ employee_id: "e2", loaded_cost: 50_000 })]);
    const { getActualPeopleCost } = await import("../bpo-pnl.service.js");
    const result = await getActualPeopleCost("2026-06");
    const branch = result.byBranch.get("b1");
    const total = (branch?.agent_salary ?? 0) + (branch?.dsc_people ?? 0) + (branch?.bmc_people ?? 0);
    expect(total, "the whole payroll run must reach the statement").toBe(150_000);
  });

  it("buckets an agent, a support role and a person with no process the same way the engine does", async () => {
    mockPayroll([
      person({ employee_id: "e1", designation_name: "EXECUTIVE" }),
      person({ employee_id: "e2", designation_name: "TEAM LEADER", loaded_cost: 80_000 }),
      // No process at all: falls to bmc_people, exactly as getPeopleCosts does.
      person({ employee_id: "e3", process_id: null, loaded_cost: 60_000 }),
    ]);
    const { getActualPeopleCost } = await import("../bpo-pnl.service.js");
    const branch = (await getActualPeopleCost("2026-06")).byBranch.get("b1")!;
    expect(branch.agent_salary).toBe(100_000);
    expect(branch.dsc_people).toBe(80_000);
    expect(branch.bmc_people).toBe(60_000);
  });

  it("groups by process as well as branch", async () => {
    mockPayroll([person({ employee_id: "e1" }), person({ employee_id: "e2", process_id: "p2", loaded_cost: 70_000 })]);
    const { getActualPeopleCost } = await import("../bpo-pnl.service.js");
    const result = await getActualPeopleCost("2026-06");
    expect(result.byProcess.get("p1")?.agent_salary).toBe(100_000);
    expect(result.byProcess.get("p2")?.agent_salary).toBe(70_000);
  });

  it("omits from the branch grain anyone carrying no branch, rather than inventing one", async () => {
    // 40 of June's 1,530 paid employees have no branch_id. Their cost cannot be attributed to a
    // branch column, and guessing would be worse than the shortfall.
    mockPayroll([person({ employee_id: "e1" }), person({ employee_id: "e2", branch_id: null, loaded_cost: 90_000 })]);
    const { getActualPeopleCost } = await import("../bpo-pnl.service.js");
    const result = await getActualPeopleCost("2026-06");
    expect(result.byBranch.get("b1")?.agent_salary).toBe(100_000);
    expect(result.byBranch.size).toBe(1);
  });

  it("reports full coverage, because everyone in a payroll run was paid by definition", async () => {
    mockPayroll([person({ employee_id: "e1" }), person({ employee_id: "e2" })]);
    const { getActualPeopleCost } = await import("../bpo-pnl.service.js");
    const cov = (await getActualPeopleCost("2026-06")).coverageByBranch.get("b1")!;
    expect(cov.coveredEmployees).toBe(cov.activeEmployees);
    expect(cov.activeEmployees).toBe(2);
  });

  it("returns empty for a malformed period instead of querying", async () => {
    mockPayroll([person()]);
    const { getActualPeopleCost } = await import("../bpo-pnl.service.js");
    const result = await getActualPeopleCost("Jun-26");
    expect(result.byBranch.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
