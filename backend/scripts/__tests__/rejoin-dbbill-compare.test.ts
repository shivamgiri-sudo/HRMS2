import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  BILL_COLUMNS,
  CAP,
  REJOIN_CLASSES,
  classifyCase,
  detectCandidates,
  formatCapped,
  normalizeAadhaar,
  normalizePan,
  parseLegacyDate,
  readOnly,
  shapeOf,
  toCandidates,
  type HrmsFacts,
  type LegacyRow,
} from "../lib/rejoinCompare.js";

const backend = path.resolve(__dirname, "../..");

let nextId = 1;
function row(p: Partial<LegacyRow> & { code: string }): LegacyRow {
  return {
    id: nextId++,
    doj: "",
    dol: "",
    status: "1",
    pan: "",
    aadhaar: "",
    lastUpdated: "",
    resignationDate: "",
    leftType: "",
    ...p,
  };
}

function facts(p: Partial<HrmsFacts> = {}): HrmsFacts {
  return {
    employmentStatus: "active",
    activeStatus: 1,
    dateOfJoining: "2024-01-01",
    dateOfExit: null,
    reactivationCount: 0,
    previousExitDate: null,
    rejoinStints: 0,
    rejoinedExits: 0,
    approvedReactivations: 0,
    ...p,
  };
}

describe("parseLegacyDate", () => {
  it("parses yyyy-mm-dd and dd/mm/yyyy", () => {
    expect(parseLegacyDate("2024-03-15")).toBe("2024-03-15");
    expect(parseLegacyDate("2024-03-15 10:20:00")).toBe("2024-03-15");
    expect(parseLegacyDate("15/03/2024")).toBe("2024-03-15");
    expect(parseLegacyDate("5/3/2024")).toBe("2024-03-05");
    expect(parseLegacyDate("15-03-2024")).toBe("2024-03-15");
  });
  it("swaps an mm/dd/yyyy value only when the month position cannot be a month", () => {
    expect(parseLegacyDate("03/25/2024")).toBe("2024-03-25");
  });
  it("returns null for empty, zero and garbage values", () => {
    for (const v of ["", "   ", "0000-00-00", "0000-00-00 00:00:00", null, undefined, "NA", "abc", "31/31/2024", "2024-13-01", "2024-02-31", "32/01/2024"]) {
      expect(parseLegacyDate(v as any), String(v)).toBeNull();
    }
  });
  it("accepts a JS Date (a DATE column read without dateStrings)", () => {
    expect(parseLegacyDate(new Date(2024, 2, 15))).toBe("2024-03-15");
    expect(parseLegacyDate(new Date("invalid"))).toBeNull();
  });
});

describe("PAN / Aadhaar normalisation", () => {
  it("normalises a real-shaped PAN and rejects malformed or dummy ones", () => {
    expect(normalizePan(" abcpe1234k ")).toBe("ABCPE1234K");
    expect(normalizePan("BXQPS 7788 L")).toBe("BXQPS7788L");
    for (const v of ["", "ABCDE1234F", "AAAAA1111A", "AAAPA0000A", "ABCPE0000K", "1234567890", "ABCPE123K", "ABCPE12345K", null, "XXXPX9999X"]) {
      expect(normalizePan(v as any), String(v)).toBeNull();
    }
  });
  it("PAN fourth character must be a holder-type letter", () => {
    expect(normalizePan("ABCZE1234K")).toBeNull();
  });
  it("normalises a 12-digit Aadhaar and rejects dummies", () => {
    expect(normalizeAadhaar("2345 6789 0123")).toBe("234567890123");
    expect(normalizeAadhaar("2345-6789-0123")).toBe("234567890123");
    for (const v of ["", "000000000000", "999999999999", "123456789012", "12345678901", "1234567890123", "XXXXXXXX0123", "012345678901", "112345678901", null]) {
      expect(normalizeAadhaar(v as any), String(v)).toBeNull();
    }
  });
});

describe("detectCandidates", () => {
  it("P1: same code on two rows with different joining dates", () => {
    const d = detectCandidates([
      row({ code: "A1", doj: "2020-01-01", dol: "2021-01-01", status: "0" }),
      row({ code: "a1 ", doj: "2022-01-01", dol: "", status: "1" }),
      row({ code: "B1", doj: "2020-01-01" }),
    ]);
    expect(d.p1.map((c) => c.code)).toEqual(["A1"]);
    expect(d.p1[0].currentActive).toBe(true);
    expect(d.p1[0].rows).toBe(2);
    expect(d.p2).toEqual([]);
  });
  it("P1: identical-DOJ duplicate rows are not a rejoin", () => {
    const d = detectCandidates([row({ code: "D1", doj: "2020-01-01" }), row({ code: "D1", doj: "01/01/2020" })]);
    expect(d.p1).toEqual([]);
    expect(d.p1DuplicateOnly).toEqual(["D1"]);
  });
  it("P1: current row is the active one, else the latest DOJ", () => {
    const d = detectCandidates([
      row({ code: "C1", doj: "2020-01-01", dol: "2020-06-01", status: "0" }),
      row({ code: "C1", doj: "2023-01-01", dol: "2023-06-01", status: "0" }),
    ]);
    expect(d.p1[0].currentActive).toBe(false);
  });
  it("P2: same PAN under different codes, non-overlapping -> OLD -> NEW", () => {
    const d = detectCandidates([
      row({ code: "OLD1", doj: "2019-01-01", dol: "2020-05-01", status: "0", pan: "BXQPS7788L" }),
      row({ code: "NEW1", doj: "2021-02-01", status: "1", pan: "bxqps7788l" }),
    ]);
    expect(d.p2).toEqual([{ oldCode: "OLD1", newCode: "NEW1", via: ["PAN"], newActive: true }]);
  });
  it("P2: leave date may come from ResignationDate; Aadhaar also links", () => {
    const d = detectCandidates([
      row({ code: "OLD2", doj: "2019-01-01", resignationDate: "10/06/2020", status: "0", aadhaar: "2345 6789 0123" }),
      row({ code: "NEW2", doj: "2020-07-01", aadhaar: "234567890123" }),
    ]);
    expect(d.p2.map((p) => `${p.oldCode}->${p.newCode}`)).toEqual(["OLD2->NEW2"]);
    expect(d.p2[0].via).toEqual(["AADHAAR"]);
  });
  it("P2: overlapping stints are NOT a rejoin", () => {
    const d = detectCandidates([
      row({ code: "X1", doj: "2019-01-01", dol: "2021-01-01", status: "0", pan: "BXQPS7788L" }),
      row({ code: "X2", doj: "2020-06-01", pan: "BXQPS7788L" }),
    ]);
    expect(d.p2).toEqual([]);
  });
  it("P2: same PAN on the same code is P1, not P2", () => {
    const d = detectCandidates([
      row({ code: "S1", doj: "2019-01-01", dol: "2020-01-01", status: "0", pan: "BXQPS7788L" }),
      row({ code: "S1", doj: "2021-01-01", pan: "BXQPS7788L" }),
    ]);
    expect(d.p2).toEqual([]);
    expect(d.p1.map((c) => c.code)).toEqual(["S1"]);
  });
  it("P2: a dummy PAN never links two people", () => {
    const d = detectCandidates([
      row({ code: "Y1", doj: "2019-01-01", dol: "2020-01-01", status: "0", pan: "ABCDE1234F" }),
      row({ code: "Y2", doj: "2021-01-01", pan: "ABCDE1234F" }),
    ]);
    expect(d.p2).toEqual([]);
  });
  it("P2: an identifier shared by more than 10 codes is a placeholder and ignored", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ code: `Z${i}`, doj: `20${10 + i}-01-01`, dol: `20${10 + i}-06-01`, status: "0", pan: "BXQPS7788L" }));
    const d = detectCandidates(rows);
    expect(d.p2).toEqual([]);
    expect(d.stats.placeholderIdentifiers).toBe(1);
  });
  it("P2: a chain links each stint to the one just before it", () => {
    const d = detectCandidates([
      row({ code: "K1", doj: "2015-01-01", dol: "2016-01-01", status: "0", pan: "BXQPS7788L" }),
      row({ code: "K2", doj: "2017-01-01", dol: "2018-01-01", status: "0", pan: "BXQPS7788L" }),
      row({ code: "K3", doj: "2019-01-01", pan: "BXQPS7788L" }),
    ]);
    expect(d.p2.map((p) => `${p.oldCode}->${p.newCode}`).sort()).toEqual(["K1->K2", "K2->K3"]);
  });
  it("P3: active single row with exit data but no DOL", () => {
    const d = detectCandidates([
      row({ code: "R1", doj: "2019-01-01", dol: "0000-00-00", status: "1", resignationDate: "2021-01-01" }),
      row({ code: "R2", doj: "2019-01-01", status: "1", leftType: "Voluntary" }),
      row({ code: "R3", doj: "2019-01-01", status: "1", leftType: "  " }),
      row({ code: "R4", doj: "2019-01-01", dol: "2021-01-01", status: "0", resignationDate: "2021-01-01" }),
    ]);
    expect(d.p3.map((c) => c.code)).toEqual(["R1", "R2"]);
  });
  it("a normal single-stint employee is not a candidate", () => {
    const d = detectCandidates([row({ code: "N1", doj: "2020-01-01", pan: "BXQPS7788L", aadhaar: "234567890123" })]);
    expect(d.p1.length + d.p2.length + d.p3.length).toBe(0);
  });
  it("toCandidates carries pattern, codes and db_bill current state", () => {
    const d = detectCandidates([
      row({ code: "A1", doj: "2020-01-01", dol: "2021-01-01", status: "0" }),
      row({ code: "A1", doj: "2022-01-01" }),
      row({ code: "OLD1", doj: "2019-01-01", dol: "2020-05-01", status: "0", pan: "BXQPS7788L" }),
      row({ code: "NEW1", doj: "2021-02-01", pan: "BXQPS7788L" }),
      row({ code: "R1", doj: "2019-01-01", resignationDate: "2021-01-01" }),
    ]);
    const c = toCandidates(d);
    expect(c).toEqual([
      { pattern: "P1", code: "A1", billCurrentActive: true },
      { pattern: "P2", code: "NEW1", oldCode: "OLD1", billCurrentActive: true },
      { pattern: "P3", code: "R1", billCurrentActive: true },
    ]);
  });
});

describe("classifyCase", () => {
  const p1 = { pattern: "P1" as const, code: "A1", billCurrentActive: true };
  const p2 = { pattern: "P2" as const, code: "NEW1", oldCode: "OLD1", billCurrentActive: true };

  it("MISSING_IN_HRMS when the current code has no employees row", () => {
    expect(classifyCase(p1, null)).toEqual(["MISSING_IN_HRMS"]);
  });
  it("P2: new missing, old missing, both missing", () => {
    expect(classifyCase(p2, null, facts())).toEqual(["MISSING_IN_HRMS"]);
    expect(classifyCase(p2, facts(), null)).toEqual(["OLD_CODE_MISSING_IN_HRMS"]);
    expect(classifyCase(p2, null, null)).toEqual(["MISSING_IN_HRMS", "OLD_CODE_MISSING_IN_HRMS"]);
  });
  it("P2: both present -> PAIR_UNLINKED_INFO, never REJOIN_TRACE_MISSING", () => {
    expect(classifyCase(p2, facts(), facts({ activeStatus: 0, employmentStatus: "inactive" }))).toEqual(["PAIR_UNLINKED_INFO"]);
  });
  it("STATUS_NOT_REFLECTED when db_bill active and HRMS inactive", () => {
    expect(classifyCase(p1, facts({ activeStatus: 0, employmentStatus: "inactive" }))).toEqual(["STATUS_NOT_REFLECTED"]);
    expect(classifyCase({ ...p1, billCurrentActive: false }, facts({ activeStatus: 0, employmentStatus: "inactive" }))).toEqual([]);
  });
  it("ACTIVE_BUT_TEXT_STALE when active_status 1 but terminal text (also STATUS_NOT_REFLECTED if db_bill active)", () => {
    expect(classifyCase({ ...p1, billCurrentActive: false }, facts({ employmentStatus: "Absconding", reactivationCount: 1 })))
      .toEqual(["ACTIVE_BUT_TEXT_STALE", "REFLECTED"]);
    expect(classifyCase(p1, facts({ employmentStatus: "inactive" })))
      .toEqual(["STATUS_NOT_REFLECTED", "ACTIVE_BUT_TEXT_STALE", "REJOIN_TRACE_MISSING"]);
  });
  it("REJOIN_TRACE_MISSING when active with no trace at all", () => {
    expect(classifyCase(p1, facts())).toEqual(["REJOIN_TRACE_MISSING"]);
    expect(classifyCase({ ...p1, pattern: "P3" }, facts())).toEqual(["REJOIN_TRACE_MISSING"]);
  });
  it("REFLECTED for each kind of trace", () => {
    for (const t of [{ rejoinStints: 1 }, { rejoinedExits: 1 }, { approvedReactivations: 1 }, { reactivationCount: 2 }, { previousExitDate: "2021-01-01" }]) {
      expect(classifyCase(p1, facts(t)), JSON.stringify(t)).toEqual(["REFLECTED"]);
    }
  });
  it("only ever returns known classes, in canonical order", () => {
    const out = classifyCase(p1, facts({ employmentStatus: "terminated", activeStatus: 1 }));
    expect(out.every((c) => (REJOIN_CLASSES as readonly string[]).includes(c))).toBe(true);
    expect([...out].sort((a, b) => REJOIN_CLASSES.indexOf(a) - REJOIN_CLASSES.indexOf(b))).toEqual(out);
  });
});

describe("readOnly guard", () => {
  it("accepts SELECT and WITH", () => {
    expect(readOnly("  SELECT 1")).toBe("  SELECT 1");
    expect(readOnly("with x as (select 1) select * from x")).toContain("select");
  });
  it("rejects every write / DDL / procedure statement", () => {
    for (const s of ["UPDATE employees SET a=1", "DELETE FROM employees", "INSERT INTO t VALUES (1)", "ALTER TABLE t ADD c INT",
      "DROP TABLE t", "TRUNCATE t", "CALL p()", "REPLACE INTO t VALUES (1)", "SET SESSION x=1", ""]) {
      expect(() => readOnly(s), s).toThrow(/read-only/);
    }
  });
  it("rejects stacked statements and locking / file-writing SELECTs", () => {
    for (const s of ["SELECT 1; DROP TABLE t", "SELECT * FROM t FOR UPDATE", "SELECT * FROM t INTO OUTFILE '/tmp/x'",
      "SELECT * FROM t LOCK IN SHARE MODE", "SELECT 1 INTO DUMPFILE '/tmp/x'"]) {
      expect(() => readOnly(s), s).toThrow(/read-only/);
    }
    expect(readOnly("SELECT 1;")).toBe("SELECT 1;");
  });
});

describe("formatCapped", () => {
  it("lists up to 50 and reports the rest", () => {
    expect(CAP).toBe(50);
    const items = Array.from({ length: 53 }, (_, i) => `E${i}`);
    const lines = formatCapped(items);
    expect(lines).toHaveLength(51);
    expect(lines[0]).toBe("  E0");
    expect(lines[50]).toBe("  ... 3 more not shown (cap 50)");
  });
  it("prints (none) for an empty list and no overflow line at exactly the cap", () => {
    expect(formatCapped([])).toEqual(["  (none)"]);
    expect(formatCapped(Array.from({ length: 50 }, (_, i) => `E${i}`))).toHaveLength(50);
  });
});

describe("shapeOf", () => {
  it("reports a value's format without the value", () => {
    expect(shapeOf("15/03/2024")).toBe("dd/dd/dddd");
    expect(shapeOf("2024-03-15 10:00")).toBe("dddd-dd-dd dd:dd");
    expect(shapeOf("NA")).toBe("aa");
    expect(shapeOf("")).toBe("(empty)");
  });
});

describe("source-level read-only assertions", () => {
  const files = ["scripts/rejoin-dbbill-compare.ts", "scripts/lib/rejoinCompare.ts"];
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const f of files) {
    it(`${f} contains no write statements`, () => {
      const src = stripComments(readFileSync(path.join(backend, f), "utf8"));
      for (const bad of ["INSERT INTO", "UPDATE ", "DELETE FROM", "ALTER ", "DROP ", "TRUNCATE", "REPLACE INTO"]) {
        expect(src.toUpperCase().includes(bad), `${f} contains ${bad}`).toBe(false);
      }
    });
  }
  it("the script never selects everything from masjclrentry and only outputs codes", () => {
    const src = stripComments(readFileSync(path.join(backend, "scripts/rejoin-dbbill-compare.ts"), "utf8"));
    expect(src).not.toMatch(/SELECT\s+\*/i);
    expect(src).not.toMatch(/EmpName|BioCode|DOB\b|email/i);
    expect(BILL_COLUMNS).toEqual(["EmpCode", "DOJ", "DOL", "Status", "PanNo", "AdharId", "lastUpdated", "ResignationDate", "left_type"]);
    expect(src).toMatch(/READ-ONLY: nothing was changed in db_bill or mas_hrms\./);
  });
  it("main() runs only when invoked directly", () => {
    const src = readFileSync(path.join(backend, "scripts/rejoin-dbbill-compare.ts"), "utf8");
    expect(src).toMatch(/if \(\/rejoin-dbbill-compare\\\.\[tj\]s\$\/\.test\(invoked\)\)/);
  });
  it("is wired into ops-scripts.yml as a read-only script", () => {
    const wf = readFileSync(path.resolve(backend, "../.github/workflows/ops-scripts.yml"), "utf8");
    expect(wf).toMatch(/options:[\s\S]*- rejoin-dbbill-compare\n/);
    const start = wf.indexOf("rejoin-dbbill-compare)");
    expect(start).toBeGreaterThan(-1);
    const branch = wf.slice(start, wf.indexOf(";;", start));
    expect(branch).toContain("npx tsx scripts/rejoin-dbbill-compare.ts");
    expect(branch).not.toMatch(/--apply|\$FLAG/);
  });
});
