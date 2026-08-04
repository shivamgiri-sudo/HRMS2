import { describe, expect, it } from "vitest";
import { getStatement, type ComponentDefinition, type StatementDependencies } from "../pnl-statement.service.js";

function component(overrides: Partial<ComponentDefinition>): ComponentDefinition {
  return {
    component_key: "recognized_revenue",
    display_name: "Recognised Revenue",
    section_key: "revenue",
    parent_component_key: null,
    display_order: 1,
    component_type: "SOURCE_ACTUAL",
    source_field: "recognizedRevenue",
    format_type: "CURRENCY",
    sign_convention: "+",
    is_subtotal: 0,
    ...overrides,
  } as ComponentDefinition;
}

const COMPONENTS: ComponentDefinition[] = [
  component({ component_key: "recognized_revenue", source_field: "recognizedRevenue", display_order: 1 }),
  component({ component_key: "agent_salary", source_field: "agentSalary", display_order: 2 }),
  component({ component_key: "dsc_people", source_field: "dscPeople", display_order: 3 }),
  component({ component_key: "dsc_non_people", source_field: "dscNonPeople", display_order: 4 }),
  component({ component_key: "total_dsc", source_field: "dsc", display_order: 5, component_type: "SUBTOTAL", is_subtotal: 1 }),
  component({ component_key: "ebitda", source_field: "ebitda", display_order: 6, component_type: "SUBTOTAL", is_subtotal: 1 }),
  component({ component_key: "ebitda_margin_pct", source_field: "ebitdaMarginPct", display_order: 7, component_type: "RATIO", format_type: "PERCENTAGE" }),
];

function processRow(overrides: Record<string, unknown>) {
  return {
    processId: "p1",
    processName: "Process 1",
    branchId: "b1",
    branchName: "Branch 1",
    processStatus: "profitable",
    recognizedRevenue: 1000000,
    agentSalary: 400000,
    dscPeople: 100000,
    dscNonPeople: 50000,
    ebitda: 300000,
    contribution: 450000,
    ...overrides,
  } as any;
}

function makeDeps(rows: any[], overrides: Partial<StatementDependencies> = {}): StatementDependencies {
  return {
    getComponents: async () => COMPONENTS,
    getSummary: async () => ({ rows, generatedAt: "2026-08-01T00:00:00.000Z", calculationEngine: "bpo_allocation_v2" }),
    getProcessSummary: async () => ({ rows: [] }),
    ...overrides,
  };
}

describe("pnl-statement.service — transposed statement", () => {

  /**
   * Which people-cost source a period uses decides reported profit, so it is pinned here.
   *
   * The snapshot only holds employees computeRunningSalary can still produce a figure for, and it
   * cannot for a leaver. April 2026 paid 1,085 people Rs 211.57 lakh; the snapshot held 790 at
   * Rs 141.23 lakh. Preferring it on a closed month put the missing Rs 70 lakh straight into
   * operating profit as margin.
   */
  describe("people cost source depends on whether the period is closed", () => {
    const snapshotPeople = {
      byBranch: new Map(),
      byProcess: new Map([["p1", { agent_salary: 1, dsc_people: 1, bmc_people: 1 }]]),
      coverageByProcess: new Map(),
      coverageByBranch: new Map(),
    } as any;

    const openPeriod = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);

    it("uses the snapshot while the month is still running", async () => {
      const deps = makeDeps([processRow({})], { getPeopleCost: async () => snapshotPeople });
      const result = await getStatement({ period: openPeriod() }, "process", deps);
      const agent = result.rows.find((r) => r.componentKey === "agent_salary");
      // The snapshot's 1, not the row's 400000.
      expect(agent?.values.p1).toBe(1);
    });

    it("ignores the snapshot once the month has closed, using actual payroll instead", async () => {
      const deps = makeDeps([processRow({})], { getPeopleCost: async () => snapshotPeople });
      const result = await getStatement({ period: "2026-04" }, "process", deps);
      const agent = result.rows.find((r) => r.componentKey === "agent_salary");
      // The row's actual payroll figure, NOT the snapshot's token 1.
      expect(agent?.values.p1).toBe(400000);
    });
  });

  it("builds one column per process by default, deriving dsc/ebitda-margin from constituent fields", async () => {
    const rows = [processRow({})];
    const result = await getStatement({ period: "2026-08" }, "process", makeDeps(rows));

    expect(result.viewBy).toBe("process");
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0]).toMatchObject({ id: "p1", name: "Process 1" });

    const dscRow = result.rows.find((r) => r.componentKey === "total_dsc")!;
    expect(dscRow.values.p1).toBe(150000); // dscPeople + dscNonPeople

    const marginRow = result.rows.find((r) => r.componentKey === "ebitda_margin_pct")!;
    expect(marginRow.values.p1).toBeCloseTo(30, 5); // 300000 / 1000000 * 100
  });

  it("aggregates additively by branch, reconciling to the sum of constituent processes", async () => {
    // dsc mirrors what the real canonical engine always populates (dsc = dscPeople + dscNonPeople) —
    // matching that shape here so the aggregation sums the real field, not a derived fallback.
    const rows = [
      processRow({ processId: "p1", branchId: "b1", branchName: "Branch 1", recognizedRevenue: 1000000, dscPeople: 100000, dscNonPeople: 50000, dsc: 150000 }),
      processRow({ processId: "p2", branchId: "b1", branchName: "Branch 1", recognizedRevenue: 500000, dscPeople: 40000, dscNonPeople: 10000, dsc: 50000 }),
      processRow({ processId: "p3", branchId: "b2", branchName: "Branch 2", recognizedRevenue: 200000, dscPeople: 5000, dscNonPeople: 5000, dsc: 10000 }),
    ];
    const result = await getStatement({ period: "2026-08" }, "branch", makeDeps(rows));

    expect(result.columns).toHaveLength(2);
    const revenueRow = result.rows.find((r) => r.componentKey === "recognized_revenue")!;
    expect(revenueRow.values.b1).toBe(1500000);
    expect(revenueRow.values.b2).toBe(200000);
    const dscRow = result.rows.find((r) => r.componentKey === "total_dsc")!;
    expect(dscRow.values.b1).toBe(200000); // (100000+50000) + (40000+10000)
  });

  it("builds one column per LOB (plus unallocated) via processLobService, per process", async () => {
    const rows = [processRow({ processId: "p1", processName: "Process 1" })];
    const deps = makeDeps(rows, {
      getProcessSummary: async () => ({
        rows: [
          { rowType: "lob", processLobId: "lob-1", lobName: "Onboarding", recognizedRevenue: 700000, dscPeople: 70000, dscNonPeople: 30000, ebitda: 200000, contribution: 300000 },
          { rowType: "unallocated", processLobId: null, recognizedRevenue: 300000, dscPeople: 30000, dscNonPeople: 20000, ebitda: 100000, contribution: 150000 },
        ],
      }),
    });
    const result = await getStatement({ period: "2026-08" }, "lob", deps);

    expect(result.columns).toHaveLength(2);
    expect(result.columns.map((c) => c.id)).toEqual(["p1:lob-1", "p1:unallocated"]);
    const revenueRow = result.rows.find((r) => r.componentKey === "recognized_revenue")!;
    expect(revenueRow.values["p1:lob-1"]).toBe(700000);
    expect(revenueRow.values["p1:unallocated"]).toBe(300000);
  });

  it("rejects cost_centre and company view-by with a clear, non-silent error", async () => {
    const deps = makeDeps([processRow({})]);
    await expect(getStatement({ period: "2026-08" }, "cost_centre" as any, deps)).rejects.toThrow(/not yet supported/i);
    await expect(getStatement({ period: "2026-08" }, "company" as any, deps)).rejects.toThrow(/not yet supported/i);
  });

  it("orders rows by the component master's display_order", async () => {
    const rows = [processRow({})];
    const result = await getStatement({ period: "2026-08" }, "process", makeDeps(rows));
    expect(result.rows.map((r) => r.componentKey)).toEqual([
      "recognized_revenue", "agent_salary", "dsc_people", "dsc_non_people", "total_dsc", "ebitda", "ebitda_margin_pct",
    ]);
  });
});
