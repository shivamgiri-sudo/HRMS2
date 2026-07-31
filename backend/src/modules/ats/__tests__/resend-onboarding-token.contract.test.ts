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

  it("the scope check lives in exactly one place", () => {
    // A second resend route would mean two copies that can drift.
    const sendTokenRoutes = [...onboardingRoutes.matchAll(/sendOnboardingToken\(/g)];
    expect(sendTokenRoutes).toHaveLength(1);
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
