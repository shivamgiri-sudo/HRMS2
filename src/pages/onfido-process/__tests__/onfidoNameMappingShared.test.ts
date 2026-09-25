import { describe, expect, it } from "vitest";
import {
  filterMappingRows,
  matchMethodBadge,
  sortMappingRows,
  type MappingListRow,
} from "../onfidoNameMappingShared";

function row(overrides: Partial<MappingListRow> = {}): MappingListRow {
  return {
    id: "map-1",
    rawName: "Priya Sharma",
    rawRole: "tl",
    employeeId: "emp-1",
    matchConfidence: 1,
    matchMethod: "exact_name",
    verifiedByHr: false,
    employeeName: "Priya Sharma",
    employeeCode: "MAS001",
    ...overrides,
  };
}

describe("matchMethodBadge", () => {
  it("gives an exact match no severity className (this project defines no 'good' tier)", () => {
    expect(matchMethodBadge("exact_name")).toEqual({ label: "Exact match", className: null });
  });

  it("maps ambiguous to the existing oc-severity-medium class", () => {
    expect(matchMethodBadge("ambiguous")).toEqual({ label: "Ambiguous", className: "oc-severity-medium" });
  });

  it("maps unmatched to the existing oc-severity-high class", () => {
    expect(matchMethodBadge("unmatched")).toEqual({ label: "Unmatched", className: "oc-severity-high" });
  });
});

describe("filterMappingRows", () => {
  const rows = [
    row({ id: "1", rawName: "Priya Sharma", employeeName: "Priya Sharma", employeeCode: "MAS001" }),
    row({ id: "2", rawName: "Rahul Verma", employeeName: "Rahul Verma", employeeCode: "MAS002" }),
    row({ id: "3", rawName: "Unknown Name", employeeName: null, employeeCode: null }),
  ];

  it("returns every row when the search string is blank", () => {
    expect(filterMappingRows(rows, "")).toHaveLength(3);
  });

  it("matches on the raw Onfido name, case-insensitively", () => {
    expect(filterMappingRows(rows, "priya").map((r) => r.id)).toEqual(["1"]);
  });

  it("matches on the employee code", () => {
    expect(filterMappingRows(rows, "mas002").map((r) => r.id)).toEqual(["2"]);
  });

  it("never throws on a row with null employeeName/employeeCode", () => {
    expect(filterMappingRows(rows, "unknown").map((r) => r.id)).toEqual(["3"]);
  });
});

describe("sortMappingRows", () => {
  it("puts unverified rows before verified rows", () => {
    const rows = [
      row({ id: "verified", verifiedByHr: true, rawName: "A Name" }),
      row({ id: "unverified", verifiedByHr: false, rawName: "Z Name" }),
    ];

    expect(sortMappingRows(rows).map((r) => r.id)).toEqual(["unverified", "verified"]);
  });

  it("within the same verified group, sorts by role then name", () => {
    const rows = [
      row({ id: "am-b", rawRole: "am", rawName: "B Name", verifiedByHr: false }),
      row({ id: "tl-a", rawRole: "tl", rawName: "A Name", verifiedByHr: false }),
      row({ id: "tl-b", rawRole: "tl", rawName: "B Name", verifiedByHr: false }),
    ];

    expect(sortMappingRows(rows).map((r) => r.id)).toEqual(["am-b", "tl-a", "tl-b"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ id: "1" }), row({ id: "2" })];
    const original = [...rows];

    sortMappingRows(rows);

    expect(rows).toEqual(original);
  });
});
