/**
 * scopeAccess.ts's getUserRoleKeys()/hasAnyRole()/buildScopeWhereClause() query `user_roles`
 * directly for the logged-in user's id. Every labelled demo/mock-token account (including the
 * super_admin one) has no row there — DEMO_TOKEN_MAP ids like "demo-super-admin-id" are never
 * inserted into user_roles — so hasAnyRole() silently returned false even for a demo super_admin,
 * and every scope-filtered query (Employee Directory among them) resolved to zero rows.
 *
 * This exact class of bug already broke the Report Library once (see demoAuth.ts's
 * demoRoleForUserId() doc comment and its use in reporting.scope.ts's resolveBranchScope) and
 * was fixed there by appending the demo role onto whatever user_roles returns. scopeAccess.ts
 * never got the same fix. Verified live 2026-08-22: Employee Directory showed "0 employees" for
 * the demo super_admin account against a live DB holding 1,069 real active employees.
 *
 * UAT session: hrms2-scope-access-demo-role-gap (project memory).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecute = vi.fn();

vi.mock("../../db/mysql.js", () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

import { getUserRoleKeys, hasAnyRole } from "../scopeAccess.js";

const DEMO_SUPER_ADMIN_ID = "demo-super-admin-id"; // matches DEMO_TOKEN_MAP in demoAuth.ts

describe("getUserRoleKeys falls back to the demo role for demo-bypass ids", () => {
  const originalBypass = process.env.INTERNAL_DEMO_BYPASS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockExecute.mockReset();
    // No user_roles row for a demo id — this is the real, live shape of the bug.
    mockExecute.mockResolvedValue([[], []]);
    process.env.INTERNAL_DEMO_BYPASS = "true";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.INTERNAL_DEMO_BYPASS = originalBypass;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("includes the demo super_admin role even though user_roles has no matching row", async () => {
    const roles = await getUserRoleKeys(DEMO_SUPER_ADMIN_ID);
    expect(roles).toContain("super_admin");
  });

  it("hasAnyRole('super_admin') is true for the demo super_admin id", async () => {
    expect(await hasAnyRole(DEMO_SUPER_ADMIN_ID, "super_admin")).toBe(true);
  });

  it("a genuinely unknown id (not in DEMO_TOKEN_MAP) still gets nothing — no blanket bypass", async () => {
    const roles = await getUserRoleKeys("some-real-user-uuid-with-no-db-row");
    expect(roles).toEqual([]);
  });

  it("does not apply the demo fallback when the bypass gate is off (production-safety)", async () => {
    process.env.NODE_ENV = "production";
    const roles = await getUserRoleKeys(DEMO_SUPER_ADMIN_ID);
    expect(roles).toEqual([]);
  });

  it("a real DB-backed role for the same id is preserved alongside the demo role", async () => {
    mockExecute.mockResolvedValue([[{ role_key: "hr" }], []]);
    const roles = await getUserRoleKeys(DEMO_SUPER_ADMIN_ID);
    expect(roles).toContain("hr");
    expect(roles).toContain("super_admin");
  });
});
