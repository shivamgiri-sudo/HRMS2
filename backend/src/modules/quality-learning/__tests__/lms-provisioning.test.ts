/**
 * LMS provisioning for training_assignment — honest-boundary contract.
 *
 * The property every test in this file protects: this feature never writes course
 * assignments into mcn_lms. content_master/module_master/batch_master are LMS-owned
 * domains this codebase's own UAT governance checklist (CS-04) blocks changing, and
 * mcn_lms has no per-trainee content-assignment table to write to even if that rule did
 * not exist. The only LMS-side write is the EXISTING best-effort trainee_master identity
 * upsert (provisionLmsIdentityForEmployee), reused here, not duplicated.
 *
 * Source-level assertions, matching this repo's convention for modules with heavy pool
 * dependencies (see lms-identity-no-fallback.test.ts, dialer-hold.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/lms-provisioning.service.ts"),
  "utf8",
);
const GAP_SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/quality-gap.service.ts"),
  "utf8",
);
const ROUTES = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/quality-learning.routes.ts"),
  "utf8",
);

describe("never writes a course/content assignment into the LMS", () => {
  it("contains no INSERT/UPDATE/DELETE against content_master, module_master, or batch_master anywhere in the service", () => {
    expect(SERVICE).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(content_master|module_master|batch_master)/i);
  });

  it("the only external LMS call is the existing, already-reviewed provisionLmsIdentityForEmployee", () => {
    expect(SERVICE).toMatch(/import \{ provisionLmsIdentityForEmployee \} from "\.\.\/lms\/lms-provisioning\.service\.js";/);
    // No direct getLmsPool/lmsQuery usage — this module never talks to mcn_lms itself,
    // it delegates entirely to the one reviewed write path.
    expect(SERVICE).not.toMatch(/getLmsPool|lmsQuery/);
  });

  it("documents the governance boundary explicitly, so the reason survives a future edit", () => {
    expect(SERVICE).toMatch(/CS-04/);
    expect(SERVICE).toMatch(/per-trainee content-assignment table/i);
  });
});

describe("provisionLmsForAssignment — best-effort, never blocks the assignment", () => {
  it("is called from inside a try/catch in quality-gap.service.ts, after the TAT instance is already created", () => {
    const fn = GAP_SERVICE.slice(
      GAP_SERVICE.indexOf("async function createAssignmentWithTat"),
      GAP_SERVICE.indexOf("/**\n * Evaluates one active rule"),
    );
    const tatCreateIdx = fn.indexOf("createTatInstance(");
    const provisionIdx = fn.indexOf("provisionLmsForAssignment(");
    expect(tatCreateIdx).toBeGreaterThan(-1);
    expect(provisionIdx).toBeGreaterThan(tatCreateIdx);
    expect(fn.slice(provisionIdx - 50, provisionIdx + 100)).toMatch(/try \{/);
  });

  it("a provisioning failure is caught and logged, not thrown to the caller", () => {
    const fn = GAP_SERVICE.slice(
      GAP_SERVICE.indexOf("async function createAssignmentWithTat"),
      GAP_SERVICE.indexOf("/**\n * Evaluates one active rule"),
    );
    expect(fn).toMatch(/provisionLmsForAssignment\(\{ assignmentId, employeeCode: params\.employeeCode \}\);/);
    expect(fn).toMatch(/\} catch \(err\) \{\s*\n\s*console\.error/);
  });

  it("never throws itself — every branch inside provisionLmsForAssignment is caught internally", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function provisionLmsForAssignment"),
      SERVICE.indexOf("/**\n * A training coordinator"),
    );
    expect(fn).toMatch(/try \{[\s\S]*?\} catch \(err\) \{/);
  });

  it("always records a result on the training_assignment row, even on failure", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function provisionLmsForAssignment"),
      SERVICE.indexOf("/**\n * A training coordinator"),
    );
    // The UPDATE happens unconditionally after the try/catch, not only in the success branch.
    const tryCatchEnd = fn.indexOf("}", fn.lastIndexOf("catch (err)"));
    const updateIdx = fn.indexOf("UPDATE training_assignment", tryCatchEnd);
    expect(updateIdx).toBeGreaterThan(tryCatchEnd);
  });
});

describe("identity confirmed does not mean content is visible — status reflects the real gap", () => {
  it("a successful identity provision lands on content_manual_pending, not a terminal success state", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function provisionLmsForAssignment"),
      SERVICE.indexOf("/**\n * A training coordinator"),
    );
    expect(fn).toMatch(/if \(result\.externalSynced && result\.lmsLearnerId\) \{[\s\S]*?status = "content_manual_pending";/);
  });

  it("the note explicitly tells a human what they still need to do", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function provisionLmsForAssignment"),
      SERVICE.indexOf("/**\n * A training coordinator"),
    );
    expect(fn).toMatch(/training coordinator must add the mapped content/);
  });

  it("confirmLmsContentAdded is the only path to the terminal content_confirmed state", () => {
    expect(SERVICE.match(/content_confirmed/g)?.length).toBeGreaterThanOrEqual(2); // status transition target + the WHERE guard checking it's not already there
    const confirmFn = SERVICE.slice(SERVICE.indexOf("export async function confirmLmsContentAdded"));
    expect(confirmFn).toMatch(/SET lms_provisioning_status = 'content_confirmed'/);
  });

  it("confirmLmsContentAdded records who confirmed it and when, for the audit trail", () => {
    const confirmFn = SERVICE.slice(
      SERVICE.indexOf("export async function confirmLmsContentAdded"),
      SERVICE.indexOf("/** Assignments still needing"),
    );
    expect(confirmFn).toMatch(/lms_content_confirmed_by = \?/);
    expect(confirmFn).toMatch(/lms_content_confirmed_at = NOW\(\)/);
  });

  it("refuses to re-confirm an assignment that is already confirmed (guards the WHERE clause on status)", () => {
    const confirmFn = SERVICE.slice(
      SERVICE.indexOf("export async function confirmLmsContentAdded"),
      SERVICE.indexOf("/** Assignments still needing"),
    );
    expect(confirmFn).toMatch(/WHERE id = \? AND lms_provisioning_status IN \('identity_provisioned', 'content_manual_pending', 'provisioning_failed'\)/);
    expect(confirmFn).toMatch(/affectedRows === 0/);
  });
});

describe("coordinator worklist and confirm routes are correctly gated", () => {
  it("both routes require a training-shaped role, not any authenticated user", () => {
    const start = ROUTES.indexOf("// ── LMS Provisioning");
    const end = ROUTES.indexOf("// ── Employee Self-Service", start);
    const section = ROUTES.slice(start, end);
    const requireRoleCalls = [...section.matchAll(/requireRole\(([^)]*)\)/g)].map((m) => m[1]);
    expect(requireRoleCalls.length).toBe(2);
    for (const call of requireRoleCalls) {
      expect(call).toMatch(/"trainer"/);
    }
  });

  it("the worklist route lists only assignments genuinely needing action, filtered in the service not the route", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("export async function listPendingLmsContentActions"));
    expect(fn).toMatch(/lms_provisioning_status IN \('content_manual_pending', 'provisioning_failed'\)/);
    expect(fn).toMatch(/t\.status NOT IN \('completed', 'cancelled'\)/);
  });
});
