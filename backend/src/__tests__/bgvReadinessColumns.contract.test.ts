/**
 * checkBgvReadiness must query columns that exist, and must never abort a
 * creation it was designed not to block.
 *
 * The original selected three columns that are not in the schema —
 * ats_candidate.fresher, candidate_onboarding_profile.total_experience_years
 * and .previous_company — so it threw on every call. The call site at
 * employee-creation-orchestrator.service.ts is unconditional and was uncaught,
 * so a check whose own comment reads "manual review workflow - doesn't block"
 * aborted employee creation outright.
 *
 * It hid behind validateSalaryLock, which runs first and failed earlier. Fixing
 * the salary gate moved execution far enough to reach it. Production had 294
 * ats_onboarding_bridge rows with ZERO employee_id and six offers marked
 * bh_approved that produced no employee.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const bgv = fs.readFileSync(
  path.resolve(__dirname, "..", "modules", "ats", "bgv-readiness.service.ts"), "utf8");
const orch = fs.readFileSync(
  path.resolve(__dirname, "..", "modules", "employees", "employee-creation-orchestrator.service.ts"), "utf8");

/** Strip comments — the fix documents the old column names it replaced. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("BGV readiness queries real columns", () => {
  it("does not select ats_candidate.fresher", () => {
    expect(code(bgv)).not.toMatch(/c\.fresher/);
  });

  it("does not select the two missing onboarding-profile columns", () => {
    const c = code(bgv);
    expect(c).not.toMatch(/p\.total_experience_years/);
    expect(c).not.toMatch(/p\.previous_company/);
  });

  it("derives fresher from ats_candidate.experience", () => {
    // Real values: 'Fresher' (15,318 rows), 'Experience' (2,838), '0-1 Year'...
    expect(code(bgv)).toMatch(/c\.experience/);
    expect(code(bgv)).toMatch(/LIKE 'fresher%'/i);
  });

  it("reads prior employment from candidate_onboarding_experience", () => {
    const c = code(bgv);
    expect(c).toContain("candidate_onboarding_experience");
    expect(c).toContain("employer_name");
  });

  it("converts MySQL's 1/0 into what isLateralHire actually tests", () => {
    // isLateralHire compares against true | 'yes' | '1'; a raw 1 matches none.
    expect(bgv).toMatch(/Number\(candidateData\?\.fresher\) === 1/);
  });
});

describe("a readiness check cannot abort employee creation", () => {
  it("wraps checkBgvReadiness so a failure is a warning, not a throw", () => {
    const at = orch.indexOf("checkBgvReadiness(candidateId");
    expect(at).toBeGreaterThan(-1);
    const around = orch.slice(Math.max(0, at - 600), at + 900);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toMatch(/catch\s*\(bgvErr\)/);
  });

  it("still records a warning when readiness cannot be evaluated", () => {
    expect(orch).toContain("BGV readiness could not be evaluated");
  });
});
