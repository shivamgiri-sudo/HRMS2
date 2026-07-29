import { describe, expect, it } from "vitest";
import { parsePastedText, resolveRow, type LookupOption } from "../BranchBudgetImportDialog";

const COST_CENTRES: LookupOption[] = [
  { id: "cc1", code: "CC-NOI-01", name: "Noida Back Office" },
  { id: "cc2", code: "CC-NOI-02", name: "Noida Collections" },
];
const PROCESSES: LookupOption[] = [{ id: "p1", code: "PR-01", name: "Collections" }];
const VENDORS: LookupOption[] = [{ id: "v1", code: "V-100", name: "Acme Facilities" }];
const LOOKUPS = { costCentres: COST_CENTRES, processes: PROCESSES, vendors: VENDORS };

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    "Head": "Facilities",
    "Sub-head": "Rent",
    "Item / Service": "Office rent",
    "Description": "Monthly office rent",
    "Quantity": "1",
    "Unit": "Month",
    "Unit Rate": "50000",
    "Tax Treatment": "exclusive",
    "GST Rate": "18",
    "GST Type": "cgst_sgst",
    "Recoverable GST %": "100",
    "Attribution Scope": "branch_common",
    "Cost Centre Code": "",
    "Process Name": "",
    "Sharing Method": "equal_split",
    "Manual Allocations": "",
    "Preferred Vendor Code": "",
    "Business Justification": "Standard monthly rent",
    ...overrides,
  };
}

describe("parsePastedText", () => {
  it("parses a tab-separated block with a header row into row objects", () => {
    const text = "Head\tItem / Service\nFacilities\tOffice rent";
    const rows = parsePastedText(text);
    expect(rows).toEqual([{ Head: "Facilities", "Item / Service": "Office rent" }]);
  });

  it("throws when there is no data row", () => {
    expect(() => parsePastedText("Head\tItem / Service")).toThrow(/at least a header row/i);
  });
});

describe("resolveRow — branch-common lines", () => {
  it("resolves a valid equal_split branch-common row", () => {
    const result = resolveRow(baseRow(), 2, LOOKUPS);
    expect(result.error).toBeNull();
    expect(result.line).toMatchObject({
      head: "Facilities",
      subHead: "Rent",
      itemName: "Office rent",
      quantity: 1,
      unitRate: 50000,
      taxTreatment: "exclusive",
      gstRate: 18,
      attributionScope: "branch_common",
      planningLevel: "branch",
      allocationDriver: "equal_split",
    });
  });

  it("resolves manual allocations that sum to 100%", () => {
    const result = resolveRow(
      baseRow({ "Sharing Method": "manual", "Manual Allocations": "CC-NOI-01:60, CC-NOI-02:40" }),
      2,
      LOOKUPS
    );
    expect(result.error).toBeNull();
    expect(result.line?.manualAllocations).toEqual([
      { costCentreId: "cc1", percentage: 60 },
      { costCentreId: "cc2", percentage: 40 },
    ]);
  });

  it("rejects manual allocations that do not sum to 100%", () => {
    const result = resolveRow(
      baseRow({ "Sharing Method": "manual", "Manual Allocations": "CC-NOI-01:60, CC-NOI-02:30" }),
      2,
      LOOKUPS
    );
    expect(result.line).toBeNull();
    expect(result.error).toMatch(/must total 100%/);
  });

  it("rejects manual allocations referencing an unknown cost centre", () => {
    const result = resolveRow(
      baseRow({ "Sharing Method": "manual", "Manual Allocations": "CC-UNKNOWN:100" }),
      2,
      LOOKUPS
    );
    expect(result.line).toBeNull();
    expect(result.error).toMatch(/unknown cost centre/);
  });
});

describe("resolveRow — direct attribution", () => {
  it("resolves a cost-centre-direct row by cost centre code", () => {
    const result = resolveRow(baseRow({ "Attribution Scope": "cost_centre", "Cost Centre Code": "CC-NOI-01" }), 2, LOOKUPS);
    expect(result.error).toBeNull();
    expect(result.line?.costCentreId).toBe("cc1");
    expect(result.line?.planningLevel).toBe("cost_centre");
  });

  it("resolves a cost-centre-direct row by cost centre name", () => {
    const result = resolveRow(
      baseRow({ "Attribution Scope": "cost_centre", "Cost Centre Code": "Noida Collections" }),
      2,
      LOOKUPS
    );
    expect(result.line?.costCentreId).toBe("cc2");
  });

  it("rejects a cost-centre-direct row with a missing cost centre code", () => {
    const result = resolveRow(baseRow({ "Attribution Scope": "cost_centre" }), 2, LOOKUPS);
    expect(result.line).toBeNull();
    expect(result.error).toMatch(/Cost Centre Code is required/);
  });

  it("rejects a cost-centre-direct row referencing an unknown cost centre", () => {
    const result = resolveRow(
      baseRow({ "Attribution Scope": "cost_centre", "Cost Centre Code": "DOES-NOT-EXIST" }),
      2,
      LOOKUPS
    );
    expect(result.line).toBeNull();
    expect(result.error).toMatch(/was not found/);
  });

  it("resolves a process-direct row by process name", () => {
    const result = resolveRow(baseRow({ "Attribution Scope": "process", "Process Name": "Collections" }), 2, LOOKUPS);
    expect(result.error).toBeNull();
    expect(result.line?.processId).toBe("p1");
  });
});

describe("resolveRow — required fields and ranges", () => {
  it("rejects a row missing a required column", () => {
    const result = resolveRow(baseRow({ "Head": "" }), 2, LOOKUPS);
    expect(result.line).toBeNull();
    expect(result.error).toMatch(/"Head" is required/);
  });

  it("rejects zero or negative quantity", () => {
    const result = resolveRow(baseRow({ "Quantity": "0" }), 2, LOOKUPS);
    expect(result.error).toMatch(/Quantity must be greater than zero/);
  });

  it("rejects negative unit rate", () => {
    const result = resolveRow(baseRow({ "Unit Rate": "-10" }), 2, LOOKUPS);
    expect(result.error).toMatch(/Unit rate cannot be negative/);
  });

  it("rejects an invalid tax treatment", () => {
    const result = resolveRow(baseRow({ "Tax Treatment": "made_up" }), 2, LOOKUPS);
    expect(result.error).toMatch(/Tax Treatment must be one of/);
  });

  it("rejects a GST rate outside 0-100", () => {
    const result = resolveRow(baseRow({ "GST Rate": "150" }), 2, LOOKUPS);
    expect(result.error).toMatch(/GST Rate must be between 0 and 100/);
  });

  it("resolves a preferred vendor by code", () => {
    const result = resolveRow(baseRow({ "Preferred Vendor Code": "V-100" }), 2, LOOKUPS);
    expect(result.line?.preferredVendorId).toBe("v1");
  });

  it("rejects an unknown preferred vendor code", () => {
    const result = resolveRow(baseRow({ "Preferred Vendor Code": "UNKNOWN" }), 2, LOOKUPS);
    expect(result.line).toBeNull();
    expect(result.error).toMatch(/Vendor "UNKNOWN" was not found/);
  });
});
