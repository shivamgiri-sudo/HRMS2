import { describe, expect, it } from "vitest";
import { resolveCostCentreMapping } from "../cost-centre-mapping.service.js";

interface FakeHistoryRow {
  cost_centre_id: string;
  branch_id: string | null;
  process_id: string | null;
  effective_from: string;
  effective_to: string | null;
}

interface FakeCostCentreMaster {
  id: string;
  branch_id: string | null;
  process_id: string | null;
}

function fakeExecutor(history: FakeHistoryRow[], ccMaster: FakeCostCentreMaster[] = []) {
  return {
    async execute(sql: string, params?: unknown[]) {
      if (sql.includes("FROM finance_cost_centre_mapping_history")) {
        const [costCentreId, asOf1, asOf2] = params as [string, string, string];
        const matches = history
          .filter(
            (row) =>
              row.cost_centre_id === costCentreId &&
              row.effective_from <= asOf1 &&
              (row.effective_to === null || row.effective_to >= asOf2)
          )
          .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
        return [matches, []];
      }
      if (sql.includes("FROM cost_centre_master")) {
        const [costCentreId] = params as [string];
        const row = ccMaster.find((cc) => cc.id === costCentreId);
        return [row ? [row] : [], []];
      }
      throw new Error(`fakeExecutor: unexpected query — ${sql}`);
    },
  } as any;
}

describe("resolveCostCentreMapping", () => {
  const history: FakeHistoryRow[] = [
    { cost_centre_id: "cc1", branch_id: "branch-old", process_id: "process-old", effective_from: "2020-01-01", effective_to: "2026-05-31" },
    { cost_centre_id: "cc1", branch_id: "branch-new", process_id: "process-new", effective_from: "2026-06-01", effective_to: null },
  ];

  it("resolves the mapping effective before the change date to the old branch/process", async () => {
    const result = await resolveCostCentreMapping("cc1", "2026-03-15", fakeExecutor(history));
    expect(result).toEqual({ branchId: "branch-old", processId: "process-old" });
  });

  it("resolves the mapping effective on and after the change date to the new branch/process", async () => {
    const asOfChangeDate = await resolveCostCentreMapping("cc1", "2026-06-01", fakeExecutor(history));
    expect(asOfChangeDate).toEqual({ branchId: "branch-new", processId: "process-new" });

    const wellAfter = await resolveCostCentreMapping("cc1", "2027-01-01", fakeExecutor(history));
    expect(wellAfter).toEqual({ branchId: "branch-new", processId: "process-new" });
  });

  it("resolves the day before the change to the old mapping (closed range is inclusive of effective_to)", async () => {
    const result = await resolveCostCentreMapping("cc1", "2026-05-31", fakeExecutor(history));
    expect(result).toEqual({ branchId: "branch-old", processId: "process-old" });
  });

  it("falls back to cost_centre_master's current columns when no history row matches", async () => {
    const ccMaster: FakeCostCentreMaster[] = [{ id: "cc2", branch_id: "fallback-branch", process_id: "fallback-process" }];
    const result = await resolveCostCentreMapping("cc2", "2026-01-01", fakeExecutor([], ccMaster));
    expect(result).toEqual({ branchId: "fallback-branch", processId: "fallback-process" });
  });

  it("returns null when neither history nor cost_centre_master has a record", async () => {
    const result = await resolveCostCentreMapping("cc-nonexistent", "2026-01-01", fakeExecutor([], []));
    expect(result).toBeNull();
  });
});
