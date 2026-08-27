import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  excludeOtherEntityCandidatesSql,
  isOtherEntityCandidateCode,
} from "../ats-reporting-scope.js";

/**
 * IDC is a different legal entity, and the ATS Command Center is MAS's dashboard.
 *
 * `ats_candidate` carries 2,738 rows whose candidate_code begins `IDC`: a June-2026 bulk import
 * of registered profiles with full KYC and bank details but no branch, no process, no sourcing
 * channel, no recruiter and no queue token. They were never MAS recruitment, and `mas_hrms`
 * holds no IDC employees at all — salary-voucher-bill.service.ts records the same boundary from
 * the payroll side, and the db_bill→HRMS employee migration excluded IDC outright.
 *
 * Counted as MAS arrivals they were not a rounding error. Measured on production 2026-08-27
 * they were the ENTIRETY of every unattributed bucket on the dashboard:
 *
 *              rows    no branch   no source   no recruiter   no process   selected
 *   C2026…    3,569        0           0            0             15        1,241
 *   CND-      1,903        0           0           10              0          417
 *   MAS          37        0           0            0              0           19
 *   IDC       2,738    2,735       2,735        2,735          2,735            0
 *
 * So "Unspecified branch", "Unspecified process", "Unspecified source" and "Unassigned
 * recruiter" were never missing MAS data to be recovered — they were another company's records.
 * Their 2,738 rows sat in the denominator of every rate (holding selection at 20.9% against a
 * true 30.5%), supplied all 111 stale multi-week queue entries behind a 22-day average wait, and
 * were the largest row in four separate ranked tables.
 */
describe("ATS reporting scope excludes other-entity candidates", () => {
  it("recognises IDC codes and only IDC codes", () => {
    for (const code of ["IDC62831", "IDC62773", "idc00001", " IDC12345 "]) {
      expect(isOtherEntityCandidateCode(code), code).toBe(true);
    }
    // Real MAS code shapes, from the same census.
    for (const code of ["CND-MSR880WE", "C20260612165746254_R3945", "MAS47814", "62637C", "", null, undefined]) {
      expect(isOtherEntityCandidateCode(code), String(code)).toBe(false);
    }
  });

  it("builds an alias-qualified predicate", () => {
    // The bare-table-name-into-an-aliased-query bug took out the BMI board for sixteen days.
    // This helper takes the alias for the same reason its sibling does.
    expect(excludeOtherEntityCandidatesSql("c")).toBe("c.candidate_code NOT LIKE 'IDC%'");
    expect(excludeOtherEntityCandidatesSql("ats_candidate")).toContain("ats_candidate.candidate_code");
  });

  it("is applied by the command-center query builder", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/modules/ats-full-parity/atsFullParity.service.ts"),
      "utf8",
    );
    expect(src).toContain("excludeOtherEntityCandidatesSql");
    // Both scope rules must be in the shared WHERE builder, not one of them in a single caller.
    const builder = src.slice(src.indexOf("async function buildCandidateFilters"));
    expect(builder).toContain('excludeEmployeeShapedCandidatesSql("c")');
    expect(builder).toContain('excludeOtherEntityCandidatesSql("c")');
  });

  it("reports what it excluded instead of dropping it silently", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/modules/ats-full-parity/atsFullParity.service.ts"),
      "utf8",
    );
    // A dashboard that quietly loses 2,738 rows is as misleading as one that quietly counts
    // them. The count travels in the payload so the arrival total stays reconcilable.
    expect(src).toContain("excludedOtherEntity");
  });

  it("scopes the data-integrity health probes to MAS too", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/modules/ats-full-parity/atsFullParity.service.ts"),
      "utf8",
    );
    /**
     * Without this the probes count IDC's 2,735 unattributed rows as MAS data-quality failures
     * forever — a red that no MAS action can clear, which is how a health tab trains people to
     * stop reading it.
     */
    const health = src.slice(src.indexOf("async healthCheck"));
    expect(health.slice(0, health.indexOf('return {'))).toContain("IDC%");
  });
});
