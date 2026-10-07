import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  branchFilter,
  processDisplay,
  recruiterNamer,
  reportingScope,
  sourceCode,
  sourceDisplay,
  leadSourceDisplay,
} from "../dashboard.scope.js";
import { joinedIdSql } from "../dashboard.joined.js";

describe("dashboard labels use the repo's canonical vocabulary", () => {
  it("merges every spelling of walk-in into one source", () => {
    for (const raw of ["WALKIN", "Walk-In", "walk-in", "walk in", "  Walk-in "])
      expect(sourceDisplay(raw)).toBe("Walk-in");
    expect(sourceDisplay("")).toBe("Unspecified");
    expect(sourceDisplay(null)).toBe("Unspecified");
  });

  it("round-trips a display label back to the code the SQL filter compares against", () => {
    expect(sourceCode("Walk-in")).toBe("WALK_IN");
    expect(sourceCode("Reference")).toBe("REFERRAL");
    expect(sourceCode("Unspecified")).toBe("UNSPECIFIED");
    expect(sourceCode(sourceDisplay("Recruiter"))).toBe("RECRUITER");
  });

  it("keeps unknown call-log sources readable instead of shouting them", () => {
    expect(leadSourceDisplay("WorkIndia Data Base")).toBe(
      "Workindia Data Base",
    );
    expect(leadSourceDisplay("WALKIN")).toBe("Walk-in");
  });

  it("shows internal ids in the process column as one bucket, and merges spelling variants", () => {
    expect(processDisplay("04f20ddc-67ba-11f1-adb1-00155d0ab410")).toBe(
      "Unmapped",
    );
    expect(processDisplay("")).toBe("Unspecified");
    expect(processDisplay("Backoffice")).toBe(processDisplay("Back Office"));
  });

  it("groups one recruiter written several ways and prefers the readable name", () => {
    const name = recruiterNamer([
      "SOFIYA SULTAN",
      "Sofiya Sultan",
      "SRASHTI CHAUHAN · MAS61660",
      "SRASHTI CHAUHAN",
      "Unassigned",
    ]);
    expect(name("SOFIYA SULTAN")).toBe(name("Sofiya Sultan"));
    expect(name("SRASHTI CHAUHAN · MAS61660")).toBe("SRASHTI CHAUHAN");
    expect(name("Unassigned")).toBe("Unassigned");
    expect(name("SOFIYA SULTAN")).not.toBe(name("SRASHTI CHAUHAN"));
  });

  it("filters a branch by every stored spelling, in both branch columns", () => {
    const f = branchFilter("NOIDA-2", "c");
    expect(f.sql).toContain("c.branch_display_name IN");
    expect(f.sql).toContain("c.applied_for_branch IN");
    // aliases are stored lower-cased; the column collation compares case-insensitively, so they still match "Okaya Centre"
    const lower = f.params.map((p) => p.toLowerCase());
    expect(lower).toContain("okaya centre");
    expect(lower).toContain("noida-2");
    expect(f.params.length).toBe((f.sql.match(/\?/g) ?? []).length);
  });
});

describe("reporting scope", () => {
  it("excludes legacy employee rows and the other entity", () => {
    expect(reportingScope("c")).toBe(
      "c.record_type = 'candidate' AND c.candidate_code NOT LIKE 'IDC%'",
    );
  });
});

describe("joined resolution", () => {
  it("builds a placeholder list for the resolved ids and a constant false for none", () => {
    expect(joinedIdSql("c.id", ["a", "b", "c"])).toEqual({
      sql: "c.id IN (?,?,?)",
      params: ["a", "b", "c"],
    });
    expect(joinedIdSql("id", [])).toEqual({ sql: "1=0", params: [] });
  });
});

/**
 * Same idea as exclusionAliasMatches.contract.test.ts: the numbers on these dashboards are only comparable with the rest
 * of ATS if EVERY read of ats_candidate goes through the reporting scope. Overstating counts ~4x was the original bug.
 */
describe("every dashboard query over ats_candidate applies the reporting scope", () => {
  const dir = path.resolve(__dirname, "..");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^dashboard\..*\.ts$/.test(f) && f !== "dashboard.scope.ts");
  it("finds the dashboard services", () =>
    expect(files.length).toBeGreaterThanOrEqual(5));

  for (const file of files) {
    it(`${file}`, () => {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      const offenders: string[] = [];
      for (const m of src.matchAll(/(FROM|JOIN)\s+ats_candidate\b(?!_)/g)) {
        // inspect only THIS statement: up to the backtick that closes its SQL template (nested `${...}` templates end in " :" or "}")
        const rest = src.slice(m.index!);
        const end = rest.search(/`\s*[,);]/);
        const window = rest.slice(0, end < 0 ? 600 : end);
        const scoped =
          window.includes("reportingScope(") ||
          window.includes("${w.sql}") ||
          window.includes("${wf.sql}");
        const byIdOnly = /ats_candidate\s+WHERE\s+id\s*=\s*\?/.test(
          window.slice(0, 80),
        ); // single-candidate journey, access-checked in the route
        if (!scoped && !byIdOnly)
          offenders.push(
            src.slice(m.index!, m.index! + 90).replace(/\s+/g, " "),
          );
      }
      expect(offenders).toEqual([]);
    });
  }
});
