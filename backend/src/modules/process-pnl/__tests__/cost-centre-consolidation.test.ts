import { describe, expect, it } from "vitest";
import { buildCostCentreConsolidation } from "../branch-budget.service.js";

function line(overrides: Record<string, unknown>) {
  return {
    planning_level: "cost_centre",
    cost_centre_id: "cc1",
    cost_centre_name: "Back Office",
    head: "IT",
    sub_head: "Software",
    item_name: "Process-specific software",
    unit: "Licence",
    quantity: 5,
    base_amount: 10000,
    tax_amount: 1800,
    gross_amount: 11800,
    pnl_cost_amount: 10000,
    ...overrides,
  } as any;
}

describe("buildCostCentreConsolidation", () => {
  it("groups cost-centre-planned lines sharing head/sub-head/item and sums branch totals exactly", () => {
    const lines = [
      line({ cost_centre_id: "cc1", cost_centre_name: "Back Office", quantity: 5, base_amount: 10000, gross_amount: 11800, pnl_cost_amount: 10000 }),
      line({ cost_centre_id: "cc2", cost_centre_name: "Collections", quantity: 3, base_amount: 6000, gross_amount: 7080, pnl_cost_amount: 6000 }),
      line({ cost_centre_id: "cc3", cost_centre_name: "Support", quantity: 2, base_amount: 4000, gross_amount: 4720, pnl_cost_amount: 4000 }),
    ];
    const result = buildCostCentreConsolidation(lines);
    expect(result).toHaveLength(1);
    const group = result[0];
    expect(group.head).toBe("IT");
    expect(group.subHead).toBe("Software");
    expect(group.itemName).toBe("Process-specific software");
    expect(group.branchUnit).toBe(10);
    expect(group.branchGrossAmount).toBe(23600);
    expect(group.branchPnlCostAmount).toBe(20000);
    expect(group.costCentreCount).toBe(3);
    expect(group.unitConsistent).toBe(true);
    expect(group.lines).toHaveLength(3);
  });

  it("keeps separate groups for different head/sub-head/item combinations", () => {
    const lines = [
      line({ cost_centre_id: "cc1", item_name: "Process-specific software" }),
      line({ cost_centre_id: "cc1", item_name: "Direct travel", sub_head: "Travel", unit: "Trip", quantity: 2, base_amount: 3000, gross_amount: 3540, pnl_cost_amount: 3000 }),
    ];
    const result = buildCostCentreConsolidation(lines);
    expect(result).toHaveLength(2);
  });

  it("flags unitConsistent = false when a group's lines don't share the same unit, without silently summing", () => {
    const lines = [
      line({ cost_centre_id: "cc1", unit: "Licence", quantity: 5 }),
      line({ cost_centre_id: "cc2", unit: "Seat", quantity: 3 }),
    ];
    const result = buildCostCentreConsolidation(lines);
    expect(result).toHaveLength(1);
    expect(result[0].unitConsistent).toBe(false);
    // Still sums (the amounts are money regardless of unit label), just flags the inconsistency.
    expect(result[0].branchUnit).toBe(8);
  });

  it("excludes branch-planned lines", () => {
    const lines = [
      line({ planning_level: "branch", cost_centre_id: null }),
      line({ cost_centre_id: "cc1" }),
    ];
    const result = buildCostCentreConsolidation(lines);
    expect(result).toHaveLength(1);
    expect(result[0].costCentreCount).toBe(1);
  });

  it("excludes cost-centre-planned lines with no cost_centre_id (data integrity guard)", () => {
    const lines = [line({ cost_centre_id: null })];
    const result = buildCostCentreConsolidation(lines);
    expect(result).toHaveLength(0);
  });

  it("returns an empty array when there are no cost-centre-planned lines", () => {
    expect(buildCostCentreConsolidation([])).toEqual([]);
  });
});
