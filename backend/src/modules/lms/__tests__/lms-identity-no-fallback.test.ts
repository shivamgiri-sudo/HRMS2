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

describe("the admin branch is deliberately left alone", () => {
  // The shared LMS-ADMIN identity is a separate business/security decision and is
  // reported rather than silently removed.
  it("still resolves an admin identity", () => {
    expect(RESOLVER).toMatch(/admin_user_master/);
  });
});
