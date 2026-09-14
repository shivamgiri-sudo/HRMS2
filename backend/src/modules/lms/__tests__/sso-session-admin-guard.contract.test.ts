import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GET /api/lms/sso-session mints an LMS ADMIN session, and had no authorization guard.
 *
 * The route hardcodes portal "admin" when calling buildLmsSession, and its only protection was
 * the router-level requireAuth at the top of this file. Every sibling native route checks the
 * capability it is about to hand out - /native/employee gates on ctx.access.access.employee,
 * /native/coordinator on .coordinator, and both 403 without it - while this one checked
 * nothing. Any of the 1,327 active employees could therefore call it and receive an LMS
 * administrator session: buildLmsSession writes a user_type='admin' row into the LMS's own
 * portal_sessions table and returns the token, user type and /admin launch URL to the browser.
 *
 * The shipped UI path was narrower by accident, not by design - the page it sits behind has no
 * page_catalog row, so only super_admin reaches it through the app. A page gate is a
 * client-side convenience; it is not the authorization boundary, and the API was open.
 *
 * Verified live 2026-08-16: 48 sso_session mints by 8 distinct users, three of whom hold
 * `employee` as their only role.
 *
 * SEPARATELY, AND NOT FIXED HERE: the admin identity itself is shared. resolveDirectLmsIdentity
 * picks the LMS admin with `ORDER BY CASE WHEN admin_id='LMS-ADMIN' THEN 0 ELSE 1 END LIMIT 1`
 * and never compares it to the caller, so every HRMS admin who launches the portal acts inside
 * the LMS as the same principal. That needs explicit written security acceptance - the guard
 * below narrows who can reach it, it does not make the identity per-user.
 */
const SRC = readFileSync(resolve(__dirname, "../lms.routes.ts"), "utf8");

/** The handler body, bounded so a later route cannot satisfy an assertion about this one. */
function ssoHandler(): string {
  const start = SRC.indexOf('router.get("/sso-session"');
  const end = SRC.indexOf('router.get("/launch-audit"', start);
  expect(start, "/sso-session route not found").toBeGreaterThan(-1);
  expect(end, "/launch-audit not found after it").toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("GET /api/lms/sso-session is gated on LMS admin access", () => {
  it("refuses a caller without admin access", () => {
    const handler = ssoHandler();
    expect(handler).toMatch(/if \(!ctx\.access\.access\.admin\)/);
    expect(handler).toMatch(/return res\.status\(403\)/);
  });

  it("checks before minting, not after", () => {
    const handler = ssoHandler();
    const guardAt = handler.indexOf("ctx.access.access.admin");
    const mintAt = handler.indexOf("buildLmsSession");
    expect(guardAt).toBeGreaterThan(-1);
    expect(mintAt).toBeGreaterThan(guardAt);
  });

  it("uses the same computed capability its siblings use, not a second role list", () => {
    // One definition of "may act as LMS admin". A fresh requireRole here would be a second
    // one, free to drift from lms.service.ts's canAdmin.
    const handler = ssoHandler();
    expect(handler).not.toMatch(/requireRole\(/);
  });

  it("still hands out an admin-portal session, so the guard is the only thing narrowing it", () => {
    // If this ever stops being the admin portal the guard above needs revisiting.
    expect(ssoHandler()).toMatch(/buildLmsSession\(req, ctx, "admin"\)/);
  });

  it("keeps the sibling gates it was modelled on", () => {
    expect(SRC).toMatch(/if \(!ctx\.access\.access\.employee\) return res\.status\(403\)/);
    expect(SRC).toMatch(/if \(!ctx\.access\.access\.coordinator\) return res\.status\(403\)/);
  });
});
