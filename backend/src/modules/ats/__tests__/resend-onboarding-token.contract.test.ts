/**
 * Resending the onboarding link.
 *
 * NativeATSRecruiterWorkspace's "Resend link" button posted to
 * /api/ats/onboarding/resend-token, which does not exist. Confirmed on
 * production 2026-07-31 with a valid super_admin token:
 *   {"message":"Route not found: POST /api/ats/onboarding/resend-token"}
 * so every resend failed with the button's generic error.
 *
 * No new endpoint was added. POST /api/ats/onboarding/send-token/:candidateId
 * already does exactly what a resend needs: sendOnboardingToken() issues a fresh
 * token over the previous one (ON DUPLICATE KEY UPDATE on
 * ats_onboarding_bridge), re-stamps the expiry, moves the candidate to
 * 'onboarding_sent', writes a stage-log entry and re-emails the link. Calling it
 * a second time IS the resend.
 *
 * The client was pointed at it rather than a second route being added, because
 * send-token carries a substantial branch/process scope check plus an
 * assigned-recruiter fallback. Duplicating that behind a resend path would mean
 * two copies of security-critical code that can drift apart — the failure mode
 * CLAUDE.md's "backend authorization is mandatory" rule exists to prevent.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const onboardingRoutes = readFileSync(
  resolve(process.cwd(), "src/modules/ats/ats.onboarding.routes.ts"),
  "utf8",
);
const onboardingService = readFileSync(
  resolve(process.cwd(), "src/modules/ats/ats.onboarding.service.ts"),
  "utf8",
);
const workspace = readFileSync(
  resolve(repoRoot, "src/pages/NativeATSRecruiterWorkspace.tsx"),
  "utf8",
);

describe("resend onboarding link — targets a route that exists", () => {
  it("no longer posts to the non-existent resend-token path", () => {
    expect(workspace).not.toContain("/api/ats/onboarding/resend-token");
  });

  it("posts to send-token with the candidate id in the path", () => {
    expect(workspace).toContain("/api/ats/onboarding/send-token/");
    // The route takes :candidateId as a path param, not a body field.
    expect(onboardingRoutes).toContain("'/send-token/:candidateId'");
  });
});

describe("resend onboarding link — reuses the hardened path", () => {
  it("send-token requires auth and a recruiting role", () => {
    const handler = onboardingRoutes.slice(onboardingRoutes.indexOf("'/send-token/:candidateId'"));
    expect(handler).toContain("requireAuth");
    expect(handler).toContain("requireRole(");
  });

  it("send-token enforces branch/process row scope, not just a role", () => {
    const handler = onboardingRoutes.slice(onboardingRoutes.indexOf("'/send-token/:candidateId'"));
    expect(handler).toContain("hasScopedAccess");
    expect(handler).toContain("Access denied");
  });

  it("every call site delegates to the one canonical sendOnboardingToken, not its own copy", () => {
    // A second call site is fine — a first-send endpoint with its own precondition (candidate
    // must be 'selected') was added 2026-08-23 alongside send-token — but every one of them
    // must delegate to the shared service function rather than re-implementing the scope/token
    // logic itself. That's the actual property worth guarding, not a literal call count.
    const sendTokenCalls = [...onboardingRoutes.matchAll(/sendOnboardingToken\(/g)];
    expect(sendTokenCalls.length).toBeGreaterThan(0);
    expect(onboardingRoutes).toContain("from './ats.onboarding.service");
  });
});

describe("resend onboarding link — every HR-department designation can use it, org-wide", () => {
  // 2026-08-24: an hr_head/hr_admin/etc. user (any designation other than the base 'hr' role)
  // cleared requireRole for other HR-gated pages but still 403'd here, because the role wasn't
  // in this route's own requireRole list. Same failure mode branch_hr/payroll_head/payroll_hr
  // already hit and got fixed above — guard the full HR-department set from the live role
  // matrix (uat/UAT_ROLE_MATRIX.csv) so it can't regress one designation at a time again.
  const hrDesignations = ["hr", "hr_admin", "hr_branch", "hr_head", "ho_hr", "recruitment_hr"];

  it("requireRole lists every HR-department designation", () => {
    const handler = onboardingRoutes.slice(
      onboardingRoutes.indexOf("'/send-token/:candidateId'"),
      onboardingRoutes.indexOf("h(async (req: AuthenticatedRequest, res) => {"),
    );
    for (const role of hrDesignations) {
      expect(handler).toContain(`'${role}'`);
    }
  });

  it("every HR-department designation bypasses the branch/process scope check entirely", () => {
    // Real incident, 2026-08-24: sofiya.sultan@teammas.co.in (role 'hr', correctly scoped to
    // her own branch) could only resend for the ~15% of candidates in that one branch — the
    // other ~85% span 6+ branches she has no scope row for. HR resending an onboarding link is
    // an org-wide function, not a branch one, so this must be an unconditional bypass (like
    // super_admin/admin already get), never routed through the branch-scoped hasScopedAccess
    // check at all.
    const start = onboardingRoutes.indexOf("const isHrDepartment = await hasAnyRole(");
    const handler = onboardingRoutes.slice(start, start + 250);
    for (const role of hrDesignations) {
      expect(handler).toContain(`'${role}'`);
    }
    expect(onboardingRoutes).toContain("const allowed = isHrDepartment || await hasScopedAccess(");
  });

  it("non-HR-department roles stay properly branch/process-scoped", () => {
    // The org-wide bypass is deliberately narrower than requireRole's full list — recruiter/
    // branch_hr/payroll_head/payroll_hr are NOT HR-department designations and must still go
    // through the row-scope check.
    const start = onboardingRoutes.indexOf("const allowed = isHrDepartment || await hasScopedAccess(");
    const handler = onboardingRoutes.slice(start, start + 300);
    for (const role of ["recruiter", "branch_hr", "payroll_head", "payroll_hr"]) {
      expect(handler).toContain(`'${role}'`);
    }
    for (const role of hrDesignations) {
      expect(handler).not.toContain(`'${role}'`);
    }
  });
});

describe("resend onboarding link — calling it twice really does resend", () => {
  it("the service overwrites the previous token rather than failing", () => {
    expect(onboardingService).toContain("ON DUPLICATE KEY UPDATE");
    expect(onboardingService).toContain("onboarding_token = VALUES(onboarding_token)");
    expect(onboardingService).toContain(
      "onboarding_token_expires_at = VALUES(onboarding_token_expires_at)",
    );
  });

  it("and re-sends the link to the candidate", () => {
    expect(onboardingService).toContain("sendOnboardingTokenEmail");
  });
});
