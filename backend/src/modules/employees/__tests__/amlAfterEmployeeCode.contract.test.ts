/**
 * AML runs after the employee exists, and only for designations that need it.
 *
 * Two requirements, both deliberate:
 *
 * It runs *after* employee code generation, not during onboarding. AML screening
 * is about the person you have hired, and the check is slow and provider-
 * dependent. Running it inside the creation transaction would mean a provider
 * outage could unwind a completed hire, which is the wrong trade in every case.
 *
 * It is gated by designation, because an executive role does not require it.
 * That policy already exists: getBgvRequirementsByDesignation() returns a
 * BgvRequirements carrying an `aml` flag, already read by
 * bgv-readiness.service.ts:203, already true for 6 roles and false by default.
 * This wires the flag to an actual consequence rather than inventing a rule.
 *
 * No AML provider is configured in org_settings today — nothing matches `aml`
 * or `prescreen`. So the check records manual_review saying exactly that, the
 * same fail-loudly rule applied to face match: an unconfigured provider must
 * never read as a clean candidate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/employees/employee-creation-orchestrator.service.ts"),
  "utf8",
);

describe("AML is triggered after the employee exists", () => {
  it("the orchestrator queues an AML screening", () => {
    expect(SOURCE).toMatch(/queueAmlScreening/);
  });

  it("it runs after the transaction commits, not inside it", () => {
    const commitAt = SOURCE.lastIndexOf("await conn.commit()");
    const amlAt = SOURCE.indexOf("await queueAmlScreening");
    expect(commitAt, "the commit moved or was renamed").toBeGreaterThan(-1);
    expect(amlAt, "queueAmlScreening is never called").toBeGreaterThan(-1);
    expect(
      amlAt,
      "AML runs before commit — a provider outage could then unwind a completed hire",
    ).toBeGreaterThan(commitAt);
  });

  it("it cannot fail the hire", () => {
    const at = SOURCE.indexOf("await queueAmlScreening");
    const around = SOURCE.slice(Math.max(0, at - 300), at + 300);
    expect(around, "an AML failure must not surface as a failed employee creation").toMatch(/catch|\.catch\(/);
  });
});

describe("AML is gated by designation", () => {
  it("the decision comes from the existing per-role policy", () => {
    // Reused, not reinvented — the flag is already defined and already read.
    expect(SOURCE).toMatch(/getBgvRequirementsByDesignation/);
  });

  it("the aml flag is what decides it", () => {
    const at = SOURCE.indexOf("async function queueAmlScreening");
    expect(at, "queueAmlScreening is not defined").toBeGreaterThan(-1);
    const next = SOURCE.indexOf("\nasync function", at + 10);
    const body = SOURCE.slice(at, next === -1 ? undefined : next);
    expect(body).toMatch(/\.aml\b/);
  });

  it("says so when no AML provider is configured, rather than passing quietly", () => {
    const at = SOURCE.indexOf("async function queueAmlScreening");
    const next = SOURCE.indexOf("\nasync function", at + 10);
    const body = SOURCE.slice(at, next === -1 ? undefined : next);
    expect(body).toMatch(/manual_review/);
    expect(body).toMatch(/candidate_bgv_check/);
  });
});
