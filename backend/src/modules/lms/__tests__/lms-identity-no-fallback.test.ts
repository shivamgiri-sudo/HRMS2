/**
 * resolveDirectLmsIdentity used to fall back to "the first active row" when the signed-in
 * user matched nothing:
 *
 *   coordinator -> SELECT login_id   FROM role_access_matrix WHERE active=1 ORDER BY created_at ASC LIMIT 1
 *   trainee     -> SELECT employee_id FROM user_master       WHERE active=1 ORDER BY created_at ASC LIMIT 1
 *
 * An unmapped HRMS user was therefore minted an LMS session as the OLDEST active
 * coordinator or trainee — that person's courses, progress and completions, under their
 * identity. The secondary `?? employeeCode ?? email` fallback was the same fault more
 * quietly: a session for an LMS id never verified to exist.
 *
 * This is cross-user identity assumption, not a UX inconvenience, and it cannot ship into
 * a first release. The resolver now fails closed with LMS_IDENTITY_NOT_MAPPED.
 *
 * Source-level assertions, matching this repo's convention for route files with heavy
 * pool/auth dependencies (see dead-payroll-engine.test.ts, attendance-unlock-guard.test.ts).
 * What is pinned is the ABSENCE of the fallback queries — the property that must never
 * silently return.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/lms/lms.routes.ts"),
  "utf8",
);

// The resolver body only — so assertions cannot match an unrelated query elsewhere.
const RESOLVER = SOURCE.slice(
  SOURCE.indexOf("async function resolveDirectLmsIdentity"),
  SOURCE.indexOf("async function buildLmsSession"),
);

describe("LMS identity never falls back to another user", () => {
  it("has no unqualified first-active coordinator lookup", () => {
    expect(RESOLVER).not.toMatch(/FROM role_access_matrix\s+WHERE active = 1\s+ORDER BY created_at ASC/);
  });

  it("has no unqualified first-active trainee lookup", () => {
    expect(RESOLVER).not.toMatch(/FROM user_master\s+WHERE active = 1\s+ORDER BY created_at ASC/);
  });

  it("does not mint a session from the raw employee code or email as a last resort", () => {
    expect(RESOLVER).not.toMatch(/\?\?\s*employeeCode\s*\?\?\s*email/);
  });

  it("every coordinator/trainee lookup is constrained by the caller's own identifiers", () => {
    // Each remaining SELECT in the resolver, apart from the admin branch, must bind params.
    const trainee = RESOLVER.slice(RESOLVER.indexOf("FROM user_master"));
    expect(trainee).toMatch(/employee_id = \?|email = \?/);
  });
});

describe("an unmapped user is refused, explicitly and actionably", () => {
  it("throws LMS_IDENTITY_NOT_MAPPED rather than returning an identity", () => {
    expect(RESOLVER).toMatch(/throw lmsIdentityNotMapped\("coordinator"\)/);
    expect(RESOLVER).toMatch(/throw lmsIdentityNotMapped\("trainee"\)/);
  });

  it("carries a machine-readable code and a 409, not a generic 502 outage", () => {
    expect(SOURCE).toMatch(/code = "LMS_IDENTITY_NOT_MAPPED"/);
    expect(SOURCE).toMatch(/statusCode = 409/);
    expect(SOURCE).toMatch(/code: "LMS_IDENTITY_NOT_MAPPED"/);
  });

  it("tells the user who can fix it", () => {
    expect(SOURCE).toMatch(/Ask HR or the LMS administrator/);
  });

  it("does not auto-create a mapping as a side effect of a launch", () => {
    expect(RESOLVER).not.toMatch(/INSERT INTO (role_access_matrix|user_master|lms_employee_mapping)/i);
  });
});

/**
 * The admin branch was reported and left alone by the pass above, because who may hold an LMS
 * administrator identity is a business decision rather than a code one. Owner ruling 2026-08-16
 * (decision 7) took it: LMS admin identity is per person.
 *
 * What was there was not a resolver. The pick was
 *   ORDER BY CASE WHEN admin_id = 'LMS-ADMIN' THEN 0 ELSE 1 END, created_at ASC LIMIT 1
 * so while the shared 'LMS-ADMIN' account is active it is returned unconditionally, for everyone.
 * The LMS's audit_log, login_session_log and content history then record "LMS Admin" against every
 * administrative change and no action can be attributed to a person. Verified read-only against the
 * LMS database 2026-08-16: four real named administrators are active and not one of them could ever
 * be selected. The `?? "LMS-ADMIN"` default went further still — with no active admin row at all it
 * minted a session for an id the LMS had not confirmed exists, the same fault the trainee and
 * coordinator branches were fixed for.
 */
describe("LMS admin identity is per person, not one shared account", () => {
  const ADMIN_BRANCH_RAW = RESOLVER.slice(
    RESOLVER.indexOf('if (portal === "admin")'),
    RESOLVER.indexOf('if (portal === "coordinator")'),
  );

  // Comments stripped for the absence assertions. The branch documents the query it replaced, and
  // a bare source-text search cannot tell "this is the bug" from "this is why the bug was fixed" —
  // which is exactly how this test first failed against the corrected code.
  const ADMIN_BRANCH = ADMIN_BRANCH_RAW.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("has an admin branch to test — the slice above is not empty", () => {
    // Guards the assertions below: a renamed branch would make every `not.toMatch` pass vacuously.
    expect(ADMIN_BRANCH.length).toBeGreaterThan(200);
    expect(ADMIN_BRANCH).toMatch(/admin_user_master/);
    expect(ADMIN_BRANCH_RAW.length).toBeGreaterThan(ADMIN_BRANCH.length); // comments really were stripped
  });

  it("no longer prefers the shared LMS-ADMIN account", () => {
    expect(ADMIN_BRANCH).not.toMatch(/CASE WHEN admin_id = 'LMS-ADMIN'/);
  });

  it("does not default to a hardcoded admin id when nothing matches", () => {
    expect(ADMIN_BRANCH).not.toMatch(/\?\?\s*"LMS-ADMIN"/);
  });

  it("selects the admin account bound to the caller's own employee code", () => {
    expect(ADMIN_BRANCH).toMatch(/FROM lms_admin_identity_map/);
    expect(ADMIN_BRANCH).toMatch(/hrms_employee_code = \?/);
  });

  it("re-checks the mapped account against the LMS, so a stale row cannot mint a session", () => {
    // The mapping is HRMS-side; the LMS deactivates its own accounts. A row here must never be
    // sufficient on its own.
    expect(ADMIN_BRANCH).toMatch(/FROM admin_user_master\s+WHERE active = 1 AND admin_id = \?/);
  });

  it("refuses rather than guessing when the caller has no mapping", () => {
    expect(ADMIN_BRANCH).toMatch(/throw lmsIdentityNotMapped\("admin"\)/);
  });

  it("refuses when the caller has no employee code to map on", () => {
    expect(ADMIN_BRANCH).toMatch(/if \(!employeeCode\) throw lmsIdentityNotMapped\("admin"\)/);
  });

  it("does not create the mapping as a side effect of a launch", () => {
    // Self-mapping on first launch would reintroduce the defect: whoever launches first takes the
    // identity, and the mapping is then indistinguishable from a deliberate one.
    expect(ADMIN_BRANCH).not.toMatch(/INSERT INTO lms_admin_identity_map/i);
  });

  it("points the administrator at HRMS, where the mapping actually lives", () => {
    expect(SOURCE).toMatch(/lms_admin_identity_map\), so your actions in the LMS are recorded as yours/);
  });
});
