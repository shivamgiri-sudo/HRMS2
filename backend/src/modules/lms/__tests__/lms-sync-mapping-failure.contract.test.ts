/**
 * syncAssessmentScores mapping-failure counting.
 *
 * `if (!hrmsEmpId) continue;` used to skip an unmappable assessment attempt without
 * pushing anything to the function's own errors[] array — the array that alone drives
 * lms_sync_audit_log.status ("success" iff errors.length === 0). A run where EVERY
 * attempt failed to map could still be logged as status='success', with nothing in
 * the audit trail to say otherwise. This is source-text inspection, matching the
 * style of notification-wiring.test.ts and lms-launch-context-portal.contract.test.ts
 * — it catches the branch losing its errors.push() again, not runtime behavior.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/modules/lms/lms.sync.service.ts"), "utf8");

/** The body of syncAssessmentScores, isolated so matches elsewhere in the file don't count. */
function assessmentScoresBody(): string {
  const match = source.match(
    /export async function syncAssessmentScores[\s\S]*?\n\}/,
  );
  if (!match) throw new Error("syncAssessmentScores function not found in lms.sync.service.ts");
  return match[0];
}

describe("LMS sync: unmappable assessment attempts are counted as errors", () => {
  it("still guards on !hrmsEmpId before continuing", () => {
    expect(assessmentScoresBody()).toMatch(/if\s*\(!hrmsEmpId\)\s*\{/);
  });

  it("pushes to errors[] INSIDE the !hrmsEmpId branch, not just somewhere in the function", () => {
    // [\s\S]*? (not [^}]*) because errors.push(`...${lmsId}...`) contains its own `}`
    // from the template-literal interpolation — a brace-excluding class would stop there.
    const body = assessmentScoresBody();
    const branch = body.match(/if\s*\(!hrmsEmpId\)\s*\{[\s\S]*?\n\s*\}/);
    expect(branch, "if (!hrmsEmpId) { ... } branch not found").toBeTruthy();
    expect(
      branch![0],
      "errors.push(...) must appear inside the `if (!hrmsEmpId) { ... }` block — an " +
        "unmappable attempt must be counted, or a run where every mapping fails can " +
        "still log lms_sync_audit_log.status = 'success'",
    ).toMatch(/errors\.push\(/);
  });

  it("still continues past unmappable attempts (does not change control flow)", () => {
    const body = assessmentScoresBody();
    const branch = body.match(/if\s*\(!hrmsEmpId\)\s*\{[\s\S]*?\n\s*\}/);
    expect(branch, "if (!hrmsEmpId) { ... } branch not found").toBeTruthy();
    expect(branch![0]).toMatch(/continue;/);
  });
});
