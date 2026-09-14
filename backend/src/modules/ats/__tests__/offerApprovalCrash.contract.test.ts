/**
 * Approving an offer must not 500.
 *
 * Observed on production 2026-08-04, /ats/offer-approvals:
 *   POST /api/ats/onboarding/offers/:id/approve
 *   -> 500 "An unexpected server error occurred. Please quote reference c314f598
 *           if you contact HR."
 *
 * The throw came from checkBgvReadiness, which selected `c.fresher`,
 * `p.total_experience_years` and `p.previous_company`. None of the three is a
 * column in mas_hrms — verified against the live schema — so MySQL answered
 * ER_BAD_FIELD_ERROR: Unknown column 'c.fresher' in 'field list' on every call.
 * That is a bare mysql error with no `statusCode`, so errorHandler masked it as
 * the generic reference message and no branch head could approve anything.
 *
 * It also stranded the record. approveOffer reverts its own decision row only
 * when createEmployeeFromCandidate RETURNS blockers; a throw skipped the revert
 * entirely, leaving ats_branch_head_approval='approved' with the offer still
 * 'submitted' and no employee — the state SOFIYA SULTAN / MAS62457 was left in.
 *
 * These are source contracts rather than a live call: reproducing the fault
 * needs the production schema, and the whole failure was a query written against
 * columns nobody checked.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isLateralFromExperienceLabel } from "../bgv-config.js";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Source with comments removed — JS block, JS line, and SQL line comments,
 * the last because the queries here are template literals carrying their own
 * `--` commentary.
 *
 * The phantom columns have to stay nameable in prose: the comments explaining
 * why each one is gone name all of them. Only executable code may be scanned.
 */
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

const readiness = codeOnly(read("src/modules/ats/bgv-readiness.service.ts"));
const orchestratorCode = codeOnly(read("src/modules/employees/employee-creation-orchestrator.service.ts"));
const orchestrator = read("src/modules/employees/employee-creation-orchestrator.service.ts");
const onboarding = read("src/modules/ats/ats.onboarding.service.ts");

/** Columns that do not exist anywhere in mas_hrms. Selecting any of them throws. */
const PHANTOM_COLUMNS = ["fresher", "total_experience_years", "previous_company"];

describe("BGV readiness reads columns that exist", () => {
  it("selects none of the phantom columns", () => {
    for (const column of PHANTOM_COLUMNS) {
      expect(readiness, `bgv-readiness.service.ts still selects ${column}`).not.toMatch(
        new RegExp(`\\b${column}\\b`),
      );
    }
  });

  it("reads ats_candidate.experience, the column that is actually there", () => {
    expect(readiness).toMatch(/SELECT c\.experience FROM ats_candidate/);
  });

  it("does not filter ats_candidate_documents on deleted_at", () => {
    // That table does not soft-delete and has no deleted_at column, so the
    // filter was ER_BAD_FIELD_ERROR on every readiness check.
    expect(readiness).not.toMatch(/deleted_at/);
  });
});

/**
 * The rest of the approval path, swept query by query against the live schema
 * on 2026-08-04. Fixing only the first missing column just moved the 500 one
 * query further along -- c.fresher, then p.pan_number -- so all of them are
 * pinned here.
 */
describe("the rest of the approval path reads columns that exist", () => {
  it("validateStatutoryInfo takes PAN and Aadhaar from the candidate only", () => {
    // candidate_onboarding_profile has no pan_number / aadhar_number. It stores
    // pan_number_masked, pan_number_hash, pan_number_encrypted and
    // aadhaar_number_masked -- and a masked value would be worse than none,
    // because it passes the format check and cannot be filed.
    expect(orchestratorCode).not.toMatch(/p\.pan_number/);
    expect(orchestratorCode).not.toMatch(/p\.aadhar_number/);
    expect(orchestratorCode).toMatch(/SELECT c\.pan_number,\s*c\.aadhar_number/);
  });

  it("never reads a masked identifier as if it were the real one", () => {
    for (const masked of ["pan_number_masked", "aadhaar_number_masked", "pan_number_hash"]) {
      expect(orchestratorCode, `orchestrator reads ${masked}`).not.toMatch(new RegExp(masked));
    }
  });

  it("takes the Payroll HR name from employees, not auth_user", () => {
    // auth_user is (id, email, password_hash, ...) -- it has no full_name, so
    // this threw and no Payroll HR was ever told a joining pack was ready.
    expect(orchestratorCode).not.toMatch(/u\.full_name/);
    expect(orchestratorCode).toMatch(/SELECT u\.email, e\.full_name/);
  });
});

describe("experience label -> lateral hire", () => {
  // Values taken from production: 'Fresher' 16,967 rows, NULL 15,424,
  // 'Experience' 2,838, then ranges.
  it.each(["Fresher", "fresher", "  FRESHER  ", "", "NA", "none", "0", "0 years"])(
    "%j is not a lateral hire",
    (label) => expect(isLateralFromExperienceLabel(label)).toBe(false),
  );

  it.each([null, undefined])("%j (unrecorded) is not a lateral hire", (label) =>
    expect(isLateralFromExperienceLabel(label)).toBe(false),
  );

  it.each(["Experience", "1-2 Years", "0-6 months", "2+ years", "3+ Years", "6-12 months"])(
    "%j is a lateral hire",
    (label) => expect(isLateralFromExperienceLabel(label)).toBe(true),
  );
});

describe("a readiness failure cannot fail the hire", () => {
  it("checkBgvReadiness is awaited inside a try/catch", () => {
    const at = orchestrator.indexOf("await checkBgvReadiness(");
    expect(at, "checkBgvReadiness call not found").toBeGreaterThan(-1);
    const preceding = orchestrator.slice(Math.max(0, at - 300), at);
    const opens = (preceding.match(/\btry\s*\{/g) ?? []).length;
    const closes = (preceding.match(/\}\s*catch\b/g) ?? []).length;
    expect(opens - closes, "readiness is not guarded — a throw here fails the approval").toBe(1);
  });

  it("degrades to a warning rather than a blocker", () => {
    const at = orchestrator.indexOf("await checkBgvReadiness(");
    const block = orchestrator.slice(at, at + 1400);
    expect(block).toContain("result.warnings.push");
    // A rollback in the catch would reinstate exactly the failure being fixed.
    const katch = block.slice(block.indexOf("} catch (bgvErr)"));
    expect(katch).not.toContain("rollback");
    expect(katch).not.toContain("result.blockers.push");
  });

  // The fraud gate must stay unguarded; it is the one BGV-adjacent check that is
  // meant to stop a hire. Guarded here so this fix cannot creep into that one.
  it("leaves the fraud alert gate unguarded", () => {
    const at = orchestrator.indexOf("await validateNoOpenFraudAlerts(");
    const block = orchestrator.slice(at, at + 500);
    expect(block).toContain("rollback");
  });
});

describe("a throw undoes the branch head decision it wrote", () => {
  it("createEmployeeFromCandidate is called inside a try/catch", () => {
    const at = onboarding.indexOf("await createEmployeeFromCandidate(");
    expect(at).toBeGreaterThan(-1);
    const preceding = onboarding.slice(Math.max(0, at - 400), at);
    const opens = (preceding.match(/\btry\s*\{/g) ?? []).length;
    const closes = (preceding.match(/\}\s*catch\b/g) ?? []).length;
    expect(opens - closes, "a throw would leave the decision row 'approved'").toBe(1);
  });

  it("reverts on the throw path as well as the blocker path", () => {
    const at = onboarding.indexOf("await createEmployeeFromCandidate(");
    const block = onboarding.slice(at, at + 700);
    const katch = block.slice(block.indexOf("} catch (err)"));
    expect(katch).toContain("undoOwnDecision");
    expect(katch).toContain("throw err");
  });

  it("still reverts when creation reports blockers", () => {
    const at = onboarding.indexOf("if (!result.success)");
    const block = onboarding.slice(at, at + 400);
    expect(block).toContain("undoOwnDecision");
  });

  it("only ever reverts a decision this call wrote", () => {
    const at = onboarding.indexOf("const undoOwnDecision");
    const block = onboarding.slice(at, at + 500);
    expect(block).toContain("decision.recorded && !decision.alreadyDecided");
  });
});
