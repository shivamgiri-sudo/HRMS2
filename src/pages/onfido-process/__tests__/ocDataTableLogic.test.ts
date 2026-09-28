import { describe, expect, it } from "vitest";
import {
  filterRows,
  nextSort,
  sortRows,
  toCsv,
  type OcSortState,
} from "../ocDataTableLogic";

type Row = { name: string; aht: number | null; team?: string };

describe("sortRows", () => {
  const rows: Row[] = [
    { name: "b", aht: 20 },
    { name: "a", aht: null },
    { name: "c", aht: 5 },
    { name: "d", aht: 100 },
  ];
  const aht = (r: Row) => r.aht;
  const name = (r: Row) => r.name;

  it("sorts numbers numerically, not as text (100 comes after 20)", () => {
    expect(sortRows(rows, aht, "asc").map((r) => r.name)).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
  });

  it("puts blanks last in both directions", () => {
    expect(sortRows(rows, aht, "desc").map((r) => r.name)).toEqual([
      "d",
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts text with natural, case-insensitive ordering", () => {
    const named = [
      { name: "Analyst 10", aht: 1 },
      { name: "analyst 2", aht: 1 },
      { name: "Analyst 1", aht: 1 },
    ];
    expect(sortRows(named, name, "asc").map((r) => r.name)).toEqual([
      "Analyst 1",
      "analyst 2",
      "Analyst 10",
    ]);
  });

  it("is stable for equal values and never mutates its input", () => {
    const input = [
      { name: "x", aht: 1 },
      { name: "y", aht: 1 },
      { name: "z", aht: 1 },
    ];
    const copy = [...input];
    expect(sortRows(input, aht, "asc").map((r) => r.name)).toEqual([
      "x",
      "y",
      "z",
    ]);
    expect(input).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("cycles asc, then desc, then off for the same column", () => {
    let s: OcSortState = null;
    s = nextSort(s, "aht");
    expect(s).toEqual({ key: "aht", dir: "asc" });
    s = nextSort(s, "aht");
    expect(s).toEqual({ key: "aht", dir: "desc" });
    s = nextSort(s, "aht");
    expect(s).toBeNull();
  });

  it("starts ascending when a different column is chosen", () => {
    expect(nextSort({ key: "aht", dir: "desc" }, "name")).toEqual({
      key: "name",
      dir: "asc",
    });
  });
});

describe("filterRows", () => {
  const rows: Row[] = [
    { name: "Aditya Ruhela", aht: 12, team: "Alpha" },
    { name: "Priya Sharma", aht: 30, team: "Beta" },
    { name: "Vicky Kumar", aht: null, team: "Alpha" },
  ];
  const accessors = [(r: Row) => r.name, (r: Row) => r.team, (r: Row) => r.aht];

  it("matches case-insensitively across every searchable column", () => {
    expect(filterRows(rows, accessors, "ALPHA").map((r) => r.name)).toEqual([
      "Aditya Ruhela",
      "Vicky Kumar",
    ]);
    expect(filterRows(rows, accessors, "sharma").map((r) => r.name)).toEqual([
      "Priya Sharma",
    ]);
  });

  it("matches numbers too, and ignores blank values", () => {
    expect(filterRows(rows, accessors, "30").map((r) => r.name)).toEqual([
      "Priya Sharma",
    ]);
  });

  it("returns every row for an empty or whitespace query", () => {
    expect(filterRows(rows, accessors, "")).toHaveLength(3);
    expect(filterRows(rows, accessors, "   ")).toHaveLength(3);
  });
});

describe("toCsv", () => {
  const cols = [
    { header: "Analyst", accessor: (r: Row) => r.name },
    { header: "AHT (s)", accessor: (r: Row) => r.aht },
  ];

  it("writes a header row and one line per row, with blanks empty", () => {
    expect(
      toCsv(cols, [
        { name: "a", aht: 5 },
        { name: "b", aht: null },
      ]),
    ).toBe("Analyst,AHT (s)\r\na,5\r\nb,");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(toCsv(cols, [{ name: 'Rao, "Sr"\nTeam', aht: 1 }])).toBe(
      'Analyst,AHT (s)\r\n"Rao, ""Sr""\nTeam",1',
    );
  });

  it("neutralises spreadsheet formula injection in text cells", () => {
    const lines = toCsv(cols, [
      { name: "=SUM(A1)", aht: 1 },
      { name: "+1", aht: 1 },
      { name: "@cmd", aht: 1 },
    ]).split("\r\n");
    expect(lines[1]).toBe("'=SUM(A1),1");
    expect(lines[2]).toBe("'+1,1");
    expect(lines[3]).toBe("'@cmd,1");
  });

  it("does not alter genuine negative numbers", () => {
    expect(toCsv(cols, [{ name: "a", aht: -4 }])).toBe(
      "Analyst,AHT (s)\r\na,-4",
    );
  });
});
