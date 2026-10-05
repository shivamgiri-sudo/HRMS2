import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  CAP_PROBE,
  CAP_SYSTEMIC,
  breakdown,
  capLines,
  classify,
  codeFamily,
  numericCore,
  parseArgs,
  readOnly,
  renderIdProbe,
  renderNameProbe,
  renderCodeProbe,
  renderSystemic,
  summarize,
  type HrmsLegacyRow,
} from "../lib/orphanCheck";

const scriptsDir = path.resolve(__dirname, "..");

describe("parseArgs", () => {
  it("accepts repeatable and comma-separated ids, names and codes", () => {
    const a = parseArgs(["--ids", "392", "--ids=393,394", "--name", "krunal", "--name=Solanki", "--codes", "mas02602, 2602C", "--codes=MAS1"]);
    expect(a.ids).toEqual([392, 393, 394]);
    expect(a.names).toEqual(["KRUNAL", "SOLANKI"]);
    expect(a.codes).toEqual(["MAS02602", "2602C", "MAS1"]);
  });

  it("de-duplicates", () => {
    const a = parseArgs(["--ids", "392,392", "--codes", "MAS1", "--codes", "mas1"]);
    expect(a.ids).toEqual([392]);
    expect(a.codes).toEqual(["MAS1"]);
  });

  it("rejects invalid ids", () => {
    for (const bad of ["0", "-1", "abc", "3.5", "1e3", "99999999999", "392;DROP"]) {
      expect(() => parseArgs(["--ids", bad])).toThrow(/invalid --ids/);
    }
    expect(() => parseArgs(["--ids"])).toThrow(/needs a value/);
  });

  it("rejects name tokens and codes that could widen a LIKE or inject", () => {
    expect(() => parseArgs(["--name", "%"])).toThrow(/invalid --name/);
    expect(() => parseArgs(["--name", "A_B"])).toThrow(/invalid --name/);
    expect(() => parseArgs(["--name", "K"])).toThrow(/invalid --name/);
    expect(() => parseArgs(["--codes", "MAS'1"])).toThrow(/invalid --codes/);
    expect(() => parseArgs(["--codes", "MAS%"])).toThrow(/invalid --codes/);
  });

  it("ignores --apply / --dry-run / --mode and rejects unknown flags", () => {
    const a = parseArgs(["--apply", "--dry-run", "--mode=apply", "--ids", "1"]);
    expect(a.ignored).toEqual(["--apply", "--dry-run", "--mode=apply"]);
    expect(a.ids).toEqual([1]);
    expect(() => parseArgs(["--write"])).toThrow(/unknown argument/);
  });
});

describe("readOnly guard", () => {
  it("allows a single SELECT or WITH", () => {
    expect(readOnly("  SELECT id FROM t WHERE id > ? ORDER BY id LIMIT 10000")).toContain("SELECT");
    expect(readOnly("with x as (select 1 a) select a from x")).toContain("select");
    expect(readOnly("SELECT id FROM t;")).toBe("SELECT id FROM t;");
  });

  it("refuses writes, stacked statements, OUTFILE, locking reads and SELECT *", () => {
    const bad = [
      "UPDATE employees SET x = 1",
      "DELETE FROM masjclrentry",
      "INSERT INTO t VALUES (1)",
      "REPLACE INTO t VALUES (1)",
      "DROP TABLE t",
      "SET SESSION x = 1",
      "SELECT id FROM t; DELETE FROM t",
      "SELECT id FROM t INTO OUTFILE '/tmp/x'",
      "SELECT id FROM t INTO DUMPFILE '/tmp/x'",
      "SELECT id INTO @v FROM t",
      "SELECT id FROM t FOR UPDATE",
      "SELECT id FROM t LOCK IN SHARE MODE",
      "SELECT * FROM t",
      "SELECT t.* FROM t",
      "",
    ];
    for (const s of bad) expect(() => readOnly(s), s).toThrow(/read-only/);
  });
});

const emp = (o: Partial<HrmsLegacyRow>): HrmsLegacyRow => ({
  employee_code: "MAS1",
  legacy_emp_id: "1",
  employment_status: "active",
  active_status: 1,
  date_of_joining: "2020-01-01",
  ...o,
});

describe("classify", () => {
  const billById = new Map<number, string>([[1, "MAS1"], [2, "MAS9999"], [5, " mas5 "]]);
  const billCodes = new Set(["MAS1", "MAS9999", "MAS5", "MAS3"]);

  it("OK when the db_bill row id still carries the same code (trim/case-insensitive)", () => {
    expect(classify(emp({}), billById, billCodes).cls).toBe("OK");
    expect(classify(emp({ employee_code: "mas5 ", legacy_emp_id: 5 }), billById, billCodes).cls).toBe("OK");
  });

  it("CODE_CHANGED when the row exists with another code", () => {
    const r = classify(emp({ employee_code: "MAS2", legacy_emp_id: "2" }), billById, billCodes);
    expect(r).toMatchObject({ cls: "CODE_CHANGED_IN_DB_BILL", billCode: "MAS9999", codeElsewhereInBill: false });
  });

  it("LEGACY_ID_MISSING when no row has that id, noting whether the code lives on elsewhere", () => {
    expect(classify(emp({ employee_code: "MAS02602", legacy_emp_id: 392 }), billById, billCodes))
      .toMatchObject({ cls: "LEGACY_ID_MISSING_IN_DB_BILL", billCode: null, codeElsewhereInBill: false });
    expect(classify(emp({ employee_code: "MAS3", legacy_emp_id: 3 }), billById, billCodes))
      .toMatchObject({ cls: "LEGACY_ID_MISSING_IN_DB_BILL", codeElsewhereInBill: true });
  });

  it("LEGACY_ID_INVALID for a non-numeric legacy id", () => {
    expect(classify(emp({ legacy_emp_id: "abc" }), billById, billCodes).cls).toBe("LEGACY_ID_INVALID");
  });

  it("HRMS_NATIVE_NOT_IN_DB_BILL / HRMS_NATIVE_IN_DB_BILL when legacy id is null", () => {
    expect(classify(emp({ employee_code: "ATS77", legacy_emp_id: null }), billById, billCodes).cls).toBe("HRMS_NATIVE_NOT_IN_DB_BILL");
    expect(classify(emp({ employee_code: "MAS3", legacy_emp_id: null }), billById, billCodes).cls).toBe("HRMS_NATIVE_IN_DB_BILL");
  });
});

describe("helpers", () => {
  it("codeFamily", () => {
    expect(codeFamily("MAS02602")).toBe("MAS");
    expect(codeFamily("idc123")).toBe("IDC");
    expect(codeFamily("63694C")).toBe("NUMC");
    expect(codeFamily("EMP1")).toBe("OTHER");
    expect(codeFamily("12345")).toBe("OTHER");
  });

  it("numericCore strips the prefix, suffix and leading zeros", () => {
    expect(numericCore("MAS02602")).toBe("2602");
    expect(numericCore("02602C")).toBe("2602");
    expect(numericCore("MASX")).toBeNull();
    expect(numericCore("MAS000")).toBeNull();
  });

  it("breakdown counts and sorts by count desc then key", () => {
    expect(breakdown(["b", "a", "b", "c", "a", "b"], (x) => x)).toEqual([["b", 3], ["a", 2], ["c", 1]]);
  });

  it("capLines caps and reports the rest", () => {
    const items = Array.from({ length: 105 }, (_, i) => `C${i}`);
    const out = capLines(items, CAP_SYSTEMIC);
    expect(out).toHaveLength(101);
    expect(out[100]).toBe("  ... 5 more not shown (cap 100)");
    expect(capLines([], 10)).toEqual(["  (none)"]);
    expect(capLines(["a"], 10)).toEqual(["  a"]);
  });

  it("summarize builds per-class breakdowns by status, DOJ year and family", () => {
    const billById = new Map<number, string>([[1, "MAS1"], [2, "MAS9"]]);
    const billCodes = new Set(["MAS1", "MAS9"]);
    const rows = [
      emp({ employee_code: "MAS1", legacy_emp_id: 1 }),
      emp({ employee_code: "MAS2", legacy_emp_id: 2, date_of_joining: "2015-03-01" }),
      emp({ employee_code: "MAS02602", legacy_emp_id: 392, employment_status: "inactive", active_status: 0, date_of_joining: "2008-08-01" }),
      emp({ employee_code: "63694C", legacy_emp_id: 400, employment_status: "inactive", active_status: 0, date_of_joining: null }),
      emp({ employee_code: "ATS1", legacy_emp_id: null }),
    ];
    const s = summarize(rows, billById, billCodes);
    expect(s.counts).toMatchObject({ OK: 1, CODE_CHANGED_IN_DB_BILL: 1, LEGACY_ID_MISSING_IN_DB_BILL: 2, HRMS_NATIVE_NOT_IN_DB_BILL: 1 });
    const missing = s.byClass.LEGACY_ID_MISSING_IN_DB_BILL;
    expect(missing.byStatus).toEqual([["inactive/0", 2]]);
    expect(missing.byYear).toEqual([["2008", 1], ["unknown", 1]]);
    expect(missing.byFamily).toEqual([["MAS", 1], ["NUMC", 1]]);
    expect(s.classOf.get("MAS02602")).toBe("LEGACY_ID_MISSING_IN_DB_BILL");
    expect(s.byClass.CODE_CHANGED_IN_DB_BILL.items).toEqual(["MAS2 -> MAS9 (legacy id 2)"]);
  });
});

describe("no PII in output", () => {
  const NAME = "KRUNAL RAJENDRAKUMAR SOLANKI";

  it("the systemic section never prints names even if a row carries one", () => {
    const billById = new Map<number, string>([[2, "MAS9"]]);
    const rows = [
      { ...emp({ employee_code: "MAS2", legacy_emp_id: 2 }), full_name: NAME, EmpName: NAME } as HrmsLegacyRow,
      { ...emp({ employee_code: "MAS02602", legacy_emp_id: 392 }), full_name: NAME } as HrmsLegacyRow,
    ];
    const text = renderSystemic(summarize(rows, billById, new Set(["MAS9"])), ["MAS02602"]).join("\n");
    expect(text).not.toContain("KRUNAL");
    expect(text).not.toContain("SOLANKI");
    expect(text).toContain("MAS02602");
    expect(text).toContain("MAS2 -> MAS9");
  });

  it("the probe section prints EmpName only for probe rows, capped at 20", () => {
    const row = { id: 7, code: "MAS7", Status: "1", DOJ: "2008-08-01", DOL: null, ResignationDate: null, left_type: null, lastUpdated: "x", EmpName: NAME };
    expect(renderIdProbe([392, 7], [row]).join("\n")).toMatch(/392.*NOT FOUND[\s\S]*MAS7[\s\S]*KRUNAL/);
    const many = Array.from({ length: 25 }, (_, i) => ({ ...row, id: i + 1, code: `MAS${i}` }));
    const out = renderNameProbe(["KRUNAL"], many, 25);
    expect(out.filter((l) => l.includes("KRUNAL RAJENDRAKUMAR")).length).toBe(CAP_PROBE);
    expect(out.join("\n")).toContain("5 more not shown");
  });

  it("the code-probe LIKE list shows codes only", () => {
    const out = renderCodeProbe("MAS02602", [], [{ id: 9, code: "MAS12602", EmpName: NAME } as never], 1).join("\n");
    expect(out).toContain("MAS12602");
    expect(out).not.toContain("KRUNAL");
  });
});

describe("source-level guarantees", () => {
  const files = ["dbbill-orphan-check.ts", "lib/orphanCheck.ts"].map((f) => readFileSync(path.join(scriptsDir, f), "utf8"));
  const sqlish = files.join("\n").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Strings only: strip the guard's own regex literals before scanning.
  const strings = (sqlish.match(/`[^`]*`|"[^"\n]*"/g) ?? []).join("\n");

  it("contains no write statements and no SELECT *", () => {
    expect(strings).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE|CREATE\s+TABLE)\b/i);
    expect(strings).not.toMatch(/SELECT\s+(\w+\.)?\*/i);
    expect(strings).not.toMatch(/INTO\s+(OUTFILE|DUMPFILE)|FOR\s+UPDATE/i);
  });

  it("imports the database modules only inside main()", () => {
    const script = files[0];
    expect(script).not.toMatch(/^import .*src\/db/m);
    expect(script).toMatch(/await import\("\.\.\/src\/db\/mysql\.js"\)/);
    expect(script).toMatch(/await import\("\.\.\/src\/db\/billDb\.js"\)/);
    expect(script).toMatch(/READ-ONLY: nothing was changed in db_bill or mas_hrms\./);
  });

  it("selects EmpName only in the probe queries", () => {
    const script = files[0];
    const selects = script.match(/`\s*SELECT[\s\S]*?`/g) ?? [];
    // EmpName is selected only through probeCols, and EmpName appears as a selected column exactly once.
    expect(selects.filter((s) => /EmpName/.test(s.split(/\bFROM\b/i)[0]))).toEqual([]);
    expect(script.match(/"EmpName"/g)).toHaveLength(1);
    expect(script).toMatch(/const probeCols = \[[\s\S]*"EmpName",\s*\]\.join/);
    const probe = selects.filter((s) => s.includes("${probeCols}"));
    expect(probe.length).toBe(3);
    for (const s of probe) expect(s).toMatch(/LIMIT \$\{CAP_PROBE\}/);
    // The systemic loads (paged by PAGE) select id and code only.
    const paged = selects.filter((s) => s.includes("${PAGE}"));
    expect(paged.length).toBe(2);
    for (const s of paged) expect(s).not.toMatch(/EmpName|probeCols/);
    expect(script).not.toMatch(/full_name|first_name|pan_number|aadhaar|mobile|email/i);
  });
});

describe("workflow wiring", () => {
  it("is wired into ops-scripts.yml as read-only with the literal investigation args", () => {
    const wf = readFileSync(path.resolve(scriptsDir, "../../.github/workflows/ops-scripts.yml"), "utf8");
    expect(wf).toMatch(/options:[\s\S]*- dbbill-orphan-check\n/);
    const start = wf.indexOf("            dbbill-orphan-check)");
    expect(start).toBeGreaterThan(-1);
    const branch = wf.slice(start, wf.indexOf(";;", start));
    expect(branch).toContain("# Read-only in both modes: SELECTs against HRMS and db_bill only.");
    expect(branch).toContain("npx tsx scripts/dbbill-orphan-check.ts --ids 392 --name KRUNAL --name SOLANKI --codes MAS02602");
    expect(branch).not.toMatch(/--apply|\$FLAG|\$MODE/);
  });
});
