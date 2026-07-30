import { describe, expect, it } from "vitest";
import { resolveBucket } from "../pnl-running-salary.service.js";
import { getStatement, type ComponentDefinition, type StatementDependencies } from "../pnl-statement.service.js";

/**
 * The running-month salary snapshot exists so a branch can see its Operating Profit part-way
 * through a month. Two things have to hold for that number to be worth showing:
 *
 *   1. Each person lands in the right P&L line (Agent / DSC / BMC).
 *   2. A column whose people cost is incomplete says so, rather than reporting the resulting
 *      inflated profit as fact.
 */

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
  component({ component_key: "dsc_salary", source_field: "dscSalary", display_order: 3 }),
  component({ component_key: "bmc_salary", source_field: "bmcSalary", display_order: 4 }),
  component({ component_key: "dc_total", source_field: "directCostTotal", display_order: 5, component_type: "SUBTOTAL", is_subtotal: 1 }),
  component({ component_key: "total_cost", source_field: "totalCost", display_order: 6, component_type: "SUBTOTAL", is_subtotal: 1 }),
  component({ component_key: "operating_profit", source_field: "operatingProfit", display_order: 7, component_type: "SUBTOTAL", is_subtotal: 1 }),
];

function branchRow(overrides: Record<string, unknown> = {}) {
  return {
    processId: "p1",
    processName: "Process 1",
    branchId: "b1",
    branchName: "Branch 1",
    processStatus: "profitable",
    recognizedRevenue: 1_000_000,
    // What the upstream engine reports without a snapshot: the whole people cost as Agent, because
    // a residual rule dumps everything there when no payroll person matched a process.
    agentSalary: 600_000,
    dscSalary: 0,
    bmcSalary: 0,
    ...overrides,
  } as any;
}

const emptyActuals = () => ({ byBranch: new Map(), byProcess: new Map() });

function makeDeps(rows: any[], overrides: Partial<StatementDependencies> = {}): StatementDependencies {
  return {
    getComponents: async () => COMPONENTS,
    getSummary: async () => ({ rows, generatedAt: "2026-07-31T00:00:00.000Z", calculationEngine: "bpo_allocation_v2" }),
    getProcessSummary: async () => ({ rows: [] }),
    getIndirectCost: async () => emptyActuals() as any,
    getDriverRevenue: async () => emptyActuals() as any,
    getPeopleCost: async () => ({
      byBranch: new Map(),
      byProcess: new Map(),
      coverageByBranch: new Map(),
      coverageByProcess: new Map(),
      asOfDate: null,
    }),
    ...overrides,
  };
}

describe("resolveBucket — which P&L line a person's salary belongs to", () => {
  it("honours a seeded classification rule over any inference", () => {
    // The rule is the business's own statement of intent; a designation heuristic must not overrule it.
    expect(resolveBucket({
      process_id: "p1",
      department_name: "OPERATIONS",
      designation_name: "Customer Support Executive",
      rule_bucket: "bmc_people",
    })).toBe("bmc_people");
  });

  it("classifies an unmapped person as BMC — no process means shared across branches", () => {
    expect(resolveBucket({
      process_id: null,
      department_name: "OPERATIONS",
      designation_name: "Customer Support Executive",
      rule_bucket: null,
    })).toBe("bmc_people");
  });

  it("classifies a process-mapped front-line agent as Agent Salary", () => {
    expect(resolveBucket({
      process_id: "p1",
      department_name: "OPERATIONS",
      designation_name: "Customer Support Executive",
      rule_bucket: null,
    })).toBe("agent_salary");
  });

  it("classifies a process-mapped support role as that process's own DSC", () => {
    for (const designation of ["Team Leader", "Quality Auditor", "Trainer", "Assistant Manager"]) {
      expect(resolveBucket({
        process_id: "p1",
        department_name: "OPERATIONS",
        designation_name: designation,
        rule_bucket: null,
      })).toBe("dsc_people");
    }
  });

  it("splits WFM by process mapping rather than by department", () => {
    // The reason 'DIALER & WFM' is deliberately left unseeded (migration 437). A WFM person tied to
    // a process is that process's support; one who is not works across branches.
    const wfm = { department_name: "DIALER & WFM", designation_name: "WFM Executive", rule_bucket: null };
    expect(resolveBucket({ ...wfm, process_id: "p1" })).toBe("dsc_people");
    expect(resolveBucket({ ...wfm, process_id: null })).toBe("bmc_people");
  });
});

describe("pnl-statement — running salary snapshot", () => {
  it("uses the snapshot's Agent/DSC/BMC split in place of the undifferentiated upstream figure", async () => {
    const deps = makeDeps([branchRow()], {
      getPeopleCost: async () => ({
        byBranch: new Map([["b1", { agent_salary: 322_479, dsc_people: 118_207, bmc_people: 81_414 }]]),
        byProcess: new Map(),
        coverageByBranch: new Map([["b1", { activeEmployees: 362, coveredEmployees: 357 }]]),
        coverageByProcess: new Map(),
        asOfDate: "2026-07-31",
      }),
    });
    const result = await getStatement({ period: "2026-07" }, "branch", deps);
    const value = (k: string) => result.rows.find((r) => r.componentKey === k)!.values.b1;

    expect(value("agent_salary")).toBe(322_479);
    expect(value("dsc_salary")).toBe(118_207);
    expect(value("bmc_salary")).toBe(81_414);
    // The upstream 600,000 Agent figure is gone entirely, not blended with the snapshot.
    expect(value("dc_total")).toBe(322_479 + 118_207 + 81_414);
    expect((result as any).peopleCostAsOf).toBe("2026-07-31");
  });

  it("keeps the upstream figure when no snapshot has been refreshed for the period", async () => {
    // An un-refreshed period must not silently zero the people cost — that would report the
    // branch's entire revenue as profit.
    const result = await getStatement({ period: "2026-07" }, "branch", makeDeps([branchRow()]));
    expect(result.rows.find((r) => r.componentKey === "agent_salary")!.values.b1).toBe(600_000);
  });

  it("reconciles: Operating Profit equals Revenue minus Total Cost", async () => {
    const deps = makeDeps([branchRow()], {
      getPeopleCost: async () => ({
        byBranch: new Map([["b1", { agent_salary: 322_479, dsc_people: 118_207, bmc_people: 81_414 }]]),
        byProcess: new Map(),
        coverageByBranch: new Map([["b1", { activeEmployees: 362, coveredEmployees: 357 }]]),
        coverageByProcess: new Map(),
        asOfDate: "2026-07-31",
      }),
      getIndirectCost: async () => ({ byBranch: new Map([["b1", 66_500]]), byProcess: new Map() }) as any,
    });
    const result = await getStatement({ period: "2026-07" }, "branch", deps);
    const value = (k: string) => result.rows.find((r) => r.componentKey === k)!.values.b1;

    expect(value("total_cost")).toBe(322_479 + 118_207 + 81_414 + 66_500);
    expect(value("operating_profit")).toBe(value("recognized_revenue") - value("total_cost"));
  });

  it("publishes people-cost coverage so an under-covered column cannot pass as complete", async () => {
    // KARNAL in July 2026: attendance carries no present days, so nobody earns and the branch
    // reports no people cost at all. Operating Profit then comes out at ~100% of revenue — entirely
    // plausible on screen, and completely wrong. Coverage is what makes that visible.
    const deps = makeDeps([branchRow({ branchId: "b2", branchName: "Branch 2", agentSalary: 0 })], {
      getPeopleCost: async () => ({
        byBranch: new Map(),
        byProcess: new Map(),
        coverageByBranch: new Map([["b2", { activeEmployees: 51, coveredEmployees: 0 }]]),
        coverageByProcess: new Map(),
        asOfDate: "2026-07-31",
      }),
    });
    const result = await getStatement({ period: "2026-07" }, "branch", deps);
    const column = result.columns.find((c) => c.id === "b2") as any;

    expect(column.peopleCostCoveragePct).toBe(0);
    expect(column.peopleCostActiveEmployees).toBe(51);
    expect(column.peopleCostCoveredEmployees).toBe(0);
  });

  it("publishes no coverage at all when the period has no snapshot", async () => {
    // A future month legitimately has nothing earned yet. Reporting it as "0% covered" would flag a
    // healthy period as broken, so coverage stays absent until a snapshot exists to be short of.
    const deps = makeDeps([branchRow()], {
      getPeopleCost: async () => ({
        byBranch: new Map(),
        byProcess: new Map(),
        coverageByBranch: new Map([["b1", { activeEmployees: 406, coveredEmployees: 0 }]]),
        coverageByProcess: new Map(),
        asOfDate: null,
      }),
    });
    const result = await getStatement({ period: "2026-08" }, "branch", deps);
    expect((result.columns.find((c) => c.id === "b1") as any).peopleCostCoveragePct).toBeUndefined();
  });

  it("reports full coverage as 100 so a healthy column is not flagged", async () => {
    const deps = makeDeps([branchRow()], {
      getPeopleCost: async () => ({
        byBranch: new Map([["b1", { agent_salary: 322_479, dsc_people: 118_207, bmc_people: 81_414 }]]),
        byProcess: new Map(),
        coverageByBranch: new Map([["b1", { activeEmployees: 200, coveredEmployees: 200 }]]),
        coverageByProcess: new Map(),
        asOfDate: "2026-07-31",
      }),
    });
    const result = await getStatement({ period: "2026-07" }, "branch", deps);
    expect((result.columns.find((c) => c.id === "b1") as any).peopleCostCoveragePct).toBe(100);
  });
});
