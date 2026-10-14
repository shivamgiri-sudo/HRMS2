import { describe, expect, it } from "vitest";
import {
  buildSavedCostCentreSplits,
  buildVendorOptions,
  mergeCostCentreSplits,
  toDateInputValue,
} from "../grn-draft-prefill";

let seq = 0;
const newKey = () => `k${++seq}`;

describe("toDateInputValue", () => {
  it("keeps a DB date string as-is (no timezone shift)", () => {
    expect(toDateInputValue("2026-10-14")).toBe("2026-10-14");
    expect(toDateInputValue("2026-10-14 00:00:00")).toBe("2026-10-14");
  });
  it("reads a Date in local time", () => {
    expect(toDateInputValue(new Date(2026, 9, 14))).toBe("2026-10-14");
  });
  it("returns blank for empty or garbage", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue("")).toBe("");
    expect(toDateInputValue("not a date")).toBe("");
  });
});

describe("buildSavedCostCentreSplits", () => {
  it("sums component rows back to one row per cost centre and never sends 'null' as a line id", () => {
    const rows = buildSavedCostCentreSplits([
      { cost_centre_id: "cc1", budget_line_id: "L1", allocation_percentage: 30 },
      { cost_centre_id: "cc1", budget_line_id: "L1", allocation_percentage: 30 },
      { cost_centre_id: "cc2", budget_line_id: null, allocation_percentage: 40 },
    ]);
    expect(rows).toEqual([
      { costCentreKey: "cc1", budgetLineId: "L1", percentage: 60, included: true },
      { costCentreKey: "cc2", budgetLineId: "", percentage: 40, included: true },
    ]);
  });
  it("falls back to the funding cost centre, then __none__", () => {
    const rows = buildSavedCostCentreSplits([
      { cost_centre_id: null, funding_cost_centre_id: "cc9", budget_line_id: "L9", allocation_percentage: 50 },
      { cost_centre_id: null, budget_line_id: "L8", allocation_percentage: 50 },
    ]);
    expect(rows.map((r) => r.costCentreKey)).toEqual(["cc9", "__none__"]);
  });
});

describe("mergeCostCentreSplits", () => {
  const groups = [
    { costCentreKey: "cc1", lines: [{ id: "L1" }, { id: "L2" }], fundableLines: [{ id: "L1" }, { id: "L2" }, { id: "S1" }] },
    { costCentreKey: "cc2", lines: [], fundableLines: [{ id: "S1" }] },
    { costCentreKey: "cc3", lines: [{ id: "L3" }] },
  ];

  it("restores a saved draft's split when the rows on screen were wiped while loading", () => {
    const saved = [
      { costCentreKey: "cc1", budgetLineId: "L2", percentage: 60, included: true },
      { costCentreKey: "cc2", budgetLineId: "S1", percentage: 40, included: true },
    ];
    const merged = mergeCostCentreSplits([], groups, saved, newKey);
    expect(merged.map(({ key: _k, ...rest }) => rest)).toEqual([
      { costCentreKey: "cc1", budgetLineId: "L2", percentage: 60, included: true },
      { costCentreKey: "cc2", budgetLineId: "S1", percentage: 40, included: true },
      { costCentreKey: "cc3", budgetLineId: "L3", percentage: 0, included: false },
    ]);
  });

  it("recovers the saved budget line when the first merge happened before lines loaded", () => {
    const saved = [{ costCentreKey: "cc1", budgetLineId: "L2", percentage: 100, included: true }];
    const early = mergeCostCentreSplits([], [{ costCentreKey: "cc1", lines: [] }], saved, newKey);
    expect(early[0]).toMatchObject({ budgetLineId: "", percentage: 100, included: true });
    const late = mergeCostCentreSplits(early, groups, saved, newKey);
    expect(late[0]).toMatchObject({ key: early[0].key, budgetLineId: "L2", percentage: 100, included: true });
  });

  it("rows already on screen win over the saved draft", () => {
    const current = [{ key: "x", costCentreKey: "cc1", budgetLineId: "L1", percentage: 25, included: false }];
    const saved = [{ costCentreKey: "cc1", budgetLineId: "L2", percentage: 60, included: true }];
    expect(mergeCostCentreSplits(current, groups, saved, newKey)[0]).toEqual(current[0]);
  });

  it("without a saved draft behaves as before: nothing pre-selected, first own line", () => {
    const merged = mergeCostCentreSplits([], groups, null, newKey);
    expect(merged.map((r) => [r.budgetLineId, r.percentage, r.included])).toEqual([
      ["L1", 0, false],
      ["", 0, false],
      ["L3", 0, false],
    ]);
  });
});

describe("buildVendorOptions", () => {
  it("keeps the saved vendor even when it is outside the search page", () => {
    const options = buildVendorOptions([{ id: "v1", vendor_name: "Alpha" }], "v9", "Zeta Traders");
    expect(options[0]).toMatchObject({ value: "v9", label: "Zeta Traders" });
    expect(options).toHaveLength(2);
  });
  it("same-name de-dup never drops the selected id", () => {
    const options = buildVendorOptions(
      [{ id: "a", vendor_name: "ACME" }, { id: "b", vendor_name: "acme " }],
      "a",
      "ACME",
    );
    expect(options).toEqual([{ value: "a", label: "ACME", hint: undefined }]);
  });
  it("no selection: plain de-duplicated list", () => {
    expect(buildVendorOptions([{ id: "a", vendor_name: "X" }, { id: "b", vendor_name: "x" }], "", null)).toHaveLength(1);
  });
});
