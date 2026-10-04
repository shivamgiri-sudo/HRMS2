import { describe, expect, it } from "vitest";
import {
  billFactsOf,
  codeFamily,
  detectCandidates,
  normLeftType,
  toCandidates,
  type Candidate,
  type HrmsFacts,
  type LegacyRow,
  type RejoinClass,
} from "../lib/rejoinCompare.js";
import {
  DETAIL_CAP,
  DETAIL_HEADER,
  NON_IDC_CAP,
  currentRejoiners,
  familyBreakdown,
  formatCurrentRejoiners,
  formatDetailRows,
  formatDetailRow,
  formatFamilySection,
  nonIdcAttention,
  type ClassifiedCase,
} from "../lib/rejoinReport.js";

let nextId = 1;
function row(p: Partial<LegacyRow> & { code: string }): LegacyRow {
  return { id: nextId++, doj: "", dol: "", status: "1", pan: "", aadhaar: "", lastUpdated: "", resignationDate: "", leftType: "", ...p };
}
function facts(p: Partial<HrmsFacts> = {}): HrmsFacts {
  return {
    employmentStatus: "active", activeStatus: 1, dateOfJoining: "2024-01-01", dateOfExit: null, reactivationCount: 0,
    previousExitDate: null, rejoinStints: 0, rejoinedExits: 0, approvedReactivations: 0, stintRows: 1, ...p,
  };
}
const p1 = (code: string): Candidate => ({ pattern: "P1", code, billCurrentActive: true });
const p3 = (code: string): Candidate => ({ pattern: "P3", code, billCurrentActive: true });
const p2 = (oldCode: string, code: string, billCurrentActive = true): Candidate => ({ pattern: "P2", code, oldCode, billCurrentActive });
const cc = (cand: Candidate, ...classes: RejoinClass[]): ClassifiedCase => ({ cand, classes });

describe("codeFamily", () => {
  it.each([
    ["IDC123", "IDC"], [" idc0001 ", "IDC"], ["IDCX", "IDC"], ["IDC", "IDC"],
    ["MAS12345", "MAS"], ["mas1", "MAS"], [" MAS001 ", "MAS"], ["MAS", "OTHER"], ["MAS12A", "OTHER"], ["XMAS1", "OTHER"],
    ["12345C", "NUMC"], ["123c", "NUMC"], [" 9C ", "NUMC"], ["C123", "OTHER"], ["12345", "OTHER"], ["12C3", "OTHER"],
    ["", "OTHER"], ["FILL00001", "OTHER"], ["ID C1", "OTHER"],
  ])("%j -> %s", (code, fam) => {
    expect(codeFamily(code)).toBe(fam);
  });
  it("tolerates null / undefined", () => {
    expect(codeFamily(null)).toBe("OTHER");
    expect(codeFamily(undefined)).toBe("OTHER");
  });
});

describe("db_bill row facts (no PII)", () => {
  it("normalises left_type to a short category or null", () => {
    expect(normLeftType("Voluntary")).toBe("Voluntary");
    expect(normLeftType(" voluntary ")).toBe("Voluntary");
    expect(normLeftType("Non Voluntary")).toBe("Non Voluntary");
    expect(normLeftType("non-voluntary")).toBe("Non Voluntary");
    expect(normLeftType("NonVoluntary")).toBe("Non Voluntary");
    expect(normLeftType("ABSCONDING")).toBe("Absconding");
    for (const v of ["", "  ", null, undefined, "NA", "left due to Mr X personal reasons", "0"]) {
      expect(normLeftType(v as any), String(v)).toBeNull();
    }
  });
  it("billFactsOf keeps only status, parsed dates and the left_type category", () => {
    const f = billFactsOf(row({
      code: "A1", status: " 1 ", doj: "15/03/2021", dol: "", resignationDate: "2023-08-15", leftType: "Voluntary",
      pan: "BXQPS7788L", aadhaar: "234567890123",
    }));
    expect(f).toEqual({ status: "1", doj: "2021-03-15", left: "2023-08-15", leftType: "Voluntary" });
    expect(Object.keys(f).sort()).toEqual(["doj", "left", "leftType", "status"]);
  });
  it("prefers DOL over ResignationDate, and garbage dates become null", () => {
    expect(billFactsOf(row({ code: "A", dol: "2022-01-31", resignationDate: "2022-01-10" })).left).toBe("2022-01-31");
    expect(billFactsOf(row({ code: "A", doj: "NA", dol: "0000-00-00", resignationDate: "NA" }))).toMatchObject({ doj: null, left: null });
    expect(billFactsOf(row({ code: "A", doj: new Date(2020, 0, 5) })).doj).toBe("2020-01-05");
  });
  it("status is reduced to a short alphanumeric token", () => {
    expect(billFactsOf(row({ code: "A", status: "Active" })).status).toBe("Active");
    expect(billFactsOf(row({ code: "A", status: null })).status).toBe("");
    expect(billFactsOf(row({ code: "A", status: "1; DROP 'x' and a very long text" })).status.length).toBeLessThanOrEqual(10);
  });
  it("detectCandidates exposes current-row facts for every candidate code (P2 old and new too)", () => {
    const d = detectCandidates([
      row({ code: "OLD1", doj: "2019-01-01", dol: "2020-05-01", status: "0", pan: "BXQPS7788L", leftType: "Absconding" }),
      row({ code: "NEW1", doj: "2021-02-01", status: "1", pan: "BXQPS7788L" }),
      row({ code: "R1", doj: "2019-01-01", resignationDate: "2021-01-01", leftType: "Voluntary" }),
      row({ code: "N1", doj: "2019-01-01" }),
    ]);
    expect(d.bill.get("OLD1")).toEqual({ status: "0", doj: "2019-01-01", left: "2020-05-01", leftType: "Absconding" });
    expect(d.bill.get("NEW1")).toEqual({ status: "1", doj: "2021-02-01", left: null, leftType: null });
    expect(d.bill.get("R1")).toEqual({ status: "1", doj: "2019-01-01", left: "2021-01-01", leftType: "Voluntary" });
    expect(d.bill.has("N1")).toBe(false);
    // the candidate objects themselves are unchanged
    expect(toCandidates(d)[0]).toEqual({ pattern: "P2", code: "NEW1", oldCode: "OLD1", billCurrentActive: true });
  });
});

describe("family breakdown", () => {
  const cases: ClassifiedCase[] = [
    cc(p2("MAS1", "IDC10"), "MISSING_IN_HRMS"),
    cc(p2("MAS2", "IDC11"), "MISSING_IN_HRMS"),
    cc(p2("MAS3", "123C"), "MISSING_IN_HRMS"),
    cc(p2("IDC20", "MAS4"), "OLD_CODE_MISSING_IN_HRMS"),
    cc(p2("MAS5", "MAS6"), "OLD_CODE_MISSING_IN_HRMS"),
    cc(p2("MAS7", "MAS8"), "PAIR_UNLINKED_INFO"),
    cc(p2("MAS9", "MAS10"), "PAIR_UNLINKED_INFO"),
    cc(p2("IDC1", "MAS11"), "PAIR_UNLINKED_INFO"),
    cc(p1("FOO1"), "STATUS_NOT_REFLECTED"),
    cc(p3("IDC30"), "REJOIN_TRACE_MISSING"),
    cc(p3("MAS12"), "REJOIN_TRACE_MISSING"),
    cc(p1("MAS13"), "REFLECTED"),
  ];
  it("counts cases per family of the code each class is about", () => {
    const b = familyBreakdown(cases);
    expect([...b.keys()]).toEqual([
      "MISSING_IN_HRMS", "OLD_CODE_MISSING_IN_HRMS", "STATUS_NOT_REFLECTED", "REJOIN_TRACE_MISSING", "PAIR_UNLINKED_INFO", "REFLECTED",
    ]);
    expect(Object.fromEntries(b.get("MISSING_IN_HRMS")!)).toEqual({ IDC: 2, NUMC: 1 });
    expect(Object.fromEntries(b.get("OLD_CODE_MISSING_IN_HRMS")!)).toEqual({ IDC: 1, MAS: 1 });
    expect(Object.fromEntries(b.get("PAIR_UNLINKED_INFO")!)).toEqual({ "MAS->MAS": 2, "IDC->MAS": 1 });
    expect([...b.get("PAIR_UNLINKED_INFO")!.keys()]).toEqual(["MAS->MAS", "IDC->MAS"]);
    expect(Object.fromEntries(b.get("STATUS_NOT_REFLECTED")!)).toEqual({ OTHER: 1 });
    expect(Object.fromEntries(b.get("REJOIN_TRACE_MISSING")!)).toEqual({ IDC: 1, MAS: 1 });
    expect(b.has("ACTIVE_BUT_TEXT_STALE")).toBe(false);
  });
  it("non-IDC headline: distinct relevant codes in attention classes, IDC ones only counted", () => {
    const a = nonIdcAttention([...cases, cc(p2("MAS99", "123C"), "MISSING_IN_HRMS")]);
    expect(a.nonIdcCodes).toEqual(["123C", "FOO1", "MAS12", "MAS5"]);
    expect(a.idcCodes).toBe(4); // IDC10, IDC11, IDC20, IDC30
    expect(Object.fromEntries(a.nonIdcByFamily)).toEqual({ MAS: 2, NUMC: 1, OTHER: 1 });
    expect(a.perClass.get("MISSING_IN_HRMS")).toEqual(["123C"]);
    expect(a.perClass.get("OLD_CODE_MISSING_IN_HRMS")).toEqual(["MAS5"]);
    expect(a.perClass.has("PAIR_UNLINKED_INFO")).toBe(false);
    expect(a.perClass.has("REFLECTED")).toBe(false);
  });
  it("formatFamilySection prints tables, the IDC note and the headline", () => {
    const lines = formatFamilySection(cases);
    const text = lines.join("\n");
    expect(lines[0]).toBe("== (3) BREAKDOWN BY CODE FAMILY ==");
    expect(text).toContain("MISSING_IN_HRMS (family of the NEW/current code; cases: 3)");
    expect(text).toMatch(/\n {4}IDC +2\n {4}NUMC +1/);
    expect(text).toContain("OLD_CODE_MISSING_IN_HRMS (family of the OLD code; cases: 2)");
    expect(text).toContain("PAIR_UNLINKED_INFO (family OLD->NEW; cases: 3)");
    expect(text).toMatch(/MAS->MAS +2/);
    expect(text).toMatch(/NOTE: .*NOT LIKE 'IDC%'/);
    expect(text).toContain("NON-IDC gaps needing attention: 4 distinct code(s) (MAS=2, NUMC=1, OTHER=1); IDC-family codes in attention classes (counted only, not listed): 4");
    expect(text).not.toContain("IDC10");
    expect(text).not.toContain("IDC30");
    expect(text).toContain("MISSING_IN_HRMS non-IDC codes: 1 (list cap 300)");
    expect(text).toContain("\n    123C");
  });
  it("lists non-IDC codes up to 300 (not 50) and reports the rest", () => {
    expect(NON_IDC_CAP).toBe(300);
    const many = Array.from({ length: 320 }, (_, i) => cc(p2(`MAS${i}`, `${1000 + i}C`), "MISSING_IN_HRMS"));
    const idc = Array.from({ length: 70 }, (_, i) => cc(p2(`MAS${i}`, `IDC${i}`), "MISSING_IN_HRMS"));
    const lines = formatFamilySection([...many, ...idc]);
    const listed = lines.filter((l) => /^ {4}\d+C$/.test(l));
    expect(listed).toHaveLength(300);
    expect(lines).toContain("    ... 20 more not shown (cap 300)");
    expect(lines.some((l) => /IDC\d/.test(l))).toBe(false);
    expect(lines.join("\n")).toContain("IDC-family codes in attention classes (counted only, not listed): 70");
  });
  it("prints a (none) headline when nothing needs attention", () => {
    const text = formatFamilySection([cc(p2("MAS1", "MAS2"), "PAIR_UNLINKED_INFO")]).join("\n");
    expect(text).toContain("NON-IDC gaps needing attention: 0 distinct code(s)");
  });
});

describe("detail rows", () => {
  it("formats one ' | '-separated line with normalised dates and '-' placeholders", () => {
    const line = formatDetailRow(p3("MAS3001"), { status: "1", doj: "2019-01-01", left: "2023-08-15", leftType: "Voluntary" },
      facts({ employmentStatus: "active", activeStatus: 1, dateOfJoining: "2019-01-01", dateOfExit: null, reactivationCount: 0, stintRows: 0 }));
    expect(line).toBe("MAS3001 | P3 | 1 | 2019-01-01 | 2023-08-15 | Voluntary | active | 1 | 2019-01-01 | - | 0 | 0");
    expect(DETAIL_HEADER.split(" | ")).toHaveLength(12);
    expect(line.split(" | ")).toHaveLength(12);
  });
  it("P2 shows the OLD->NEW pair; missing data prints '-'", () => {
    const line = formatDetailRow(p2("MAS1", "MAS2"), undefined,
      facts({ employmentStatus: null, activeStatus: null, dateOfJoining: "0000-00-00", dateOfExit: "2024-02-03", reactivationCount: null, stintRows: undefined }));
    expect(line).toBe("MAS2 | P2 MAS1->MAS2 | - | - | - | - | - | - | - | 2024-02-03 | - | -");
    expect(formatDetailRow(p1("A1"), { status: "", doj: null, left: null, leftType: null }, null))
      .toBe("A1 | P1 | - | - | - | - | - | - | - | - | - | -");
  });
  it("never prints PII and strips free text from HRMS status", () => {
    const line = formatDetailRow(p1("A1"), billFactsOf(row({ code: "A1", pan: "BXQPS7788L", aadhaar: "234567890123", leftType: "Mr X left" })),
      facts({ employmentStatus: "inactive; call 9876543210 <x>" }));
    expect(line).not.toMatch(/BXQPS7788L|234567890123/);
    expect(line.split(" | ")[6]).toMatch(/^[A-Za-z0-9 _-]{1,30}$/);
  });
  it("caps detail rows at 100 per class, sorted by code", () => {
    expect(DETAIL_CAP).toBe(100);
    const cs = Array.from({ length: 105 }, (_, i) => p3(`MAS${String(i).padStart(3, "0")}`));
    const lines = formatDetailRows(cs, new Map(), new Map());
    expect(lines[0]).toBe(`  ${DETAIL_HEADER}`);
    expect(lines).toHaveLength(1 + 100 + 1);
    expect(lines[1].startsWith("  MAS000 | P3")).toBe(true);
    expect(lines[lines.length - 1]).toBe("  ... 5 more not shown (cap 100)");
    expect(formatDetailRows([], new Map(), new Map())).toEqual(["  (none)"]);
  });
});

describe("current rejoiners under a new code (db_bill active)", () => {
  const cands: Candidate[] = [
    p2("MAS1", "MAS2"), // HRMS active -> OK
    p2("MAS3", "MAS4"), // HRMS inactive -> gap
    p2("MAS5", "MAS6"), // missing -> gap
    p2("MAS7", "MAS8"), // HRMS active_status 1 but terminal text -> not active
    p2("MAS9", "MAS6"), // same new code via a second pair -> counted once
    p2("MAS10", "MAS11", false), // historical: new code not active in db_bill -> excluded
    p1("MAS12"), p3("MAS13"),
  ];
  const f = new Map<string, HrmsFacts>([
    ["MAS2", facts()],
    ["MAS4", facts({ activeStatus: 0, employmentStatus: "inactive", dateOfExit: "2024-05-01" })],
    ["MAS8", facts({ activeStatus: 1, employmentStatus: "Absconding" })],
    ["MAS11", facts({ activeStatus: 0 })],
  ]);
  it("classifies distinct active new codes into active / present-not-active / missing", () => {
    const r = currentRejoiners(cands, f);
    expect(r.total).toBe(4);
    expect(r.active).toEqual(["MAS2"]);
    expect(r.inactive).toEqual(["MAS4", "MAS8"]);
    expect(r.missing).toEqual(["MAS6"]);
    expect(r.historical).toBe(1);
  });
  it("formats the section with counts, capped code lists and HRMS status columns", () => {
    const text = formatCurrentRejoiners(currentRejoiners(cands, f), f).join("\n");
    expect(text).toContain("== (4) CURRENT REJOINERS UNDER A NEW CODE (db_bill active) ==");
    expect(text).toContain("P2 new codes active in db_bill (distinct): 4");
    expect(text).toContain("present in HRMS and active: 1");
    expect(text).toContain("present in HRMS but NOT active: 2");
    expect(text).toContain("missing from HRMS: 1");
    expect(text).toContain("missing from HRMS, codes (cap 300):\n    MAS6");
    expect(text).toContain("    MAS4 | inactive | 0 | 2024-01-01 | 2024-05-01 | 0 | 1");
    expect(text).toContain("    MAS8 | Absconding | 1 | 2024-01-01 | - | 0 | 1");
    expect(text).not.toMatch(/\n {4}MAS2\b/);
    expect(text).toContain("historical P2 pairs whose new code is no longer active in db_bill: 1");
  });
  it("lists up to 300 missing codes", () => {
    const many = Array.from({ length: 310 }, (_, i) => p2(`MAS${i}`, `${i}C`));
    const lines = formatCurrentRejoiners(currentRejoiners(many, new Map()), new Map());
    expect(lines.filter((l) => /^ {4}\d+C$/.test(l))).toHaveLength(300);
    expect(lines).toContain("    ... 10 more not shown (cap 300)");
  });
});
