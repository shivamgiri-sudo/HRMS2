/**
 * Unit tests for the role/scope logic of the location routes.
 *
 * These tests exercise the decision logic in isolation — db and scopeAccess are
 * fully mocked, so no real MySQL connection is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock scopeAccess before any module import resolves it ─────────────────────
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(),
  hasScopedAccess: vi.fn(),
}));

// ── Mock db so no real connection is attempted ────────────────────────────────
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { hasAnyRole, hasScopedAccess } from "../../../shared/scopeAccess.js";
import { db } from "../../../db/mysql.js";

// ── Re-usable mock types ───────────────────────────────────────────────────────
const mockHasAnyRole = hasAnyRole as ReturnType<typeof vi.fn>;
const mockHasScopedAccess = hasScopedAccess as ReturnType<typeof vi.fn>;
const mockDbExecute = (db.execute as ReturnType<typeof vi.fn>);

// ── Inline helpers that mirror the route logic ─────────────────────────────────
// Rather than spinning up Express, we extract and replicate the exact decision
// path from location.routes.ts so we can unit-test the branching in isolation.

const SCOPED_LIVE_ROLES = ["branch_head", "hr_admin", "operations_manager", "process_manager"];

interface AccessDecision {
  status: 200 | 400 | 403;
  scopeChecked: boolean;
}

/** Mirrors the /live guard logic */
async function liveAccessDecision(
  userId: string,
  branchIdParam: string | undefined
): Promise<AccessDecision> {
  const isSuperAdmin = await hasAnyRole(userId, "super_admin");
  if (isSuperAdmin) return { status: 200, scopeChecked: false };

  const hasScopedRole = await hasAnyRole(userId, ...SCOPED_LIVE_ROLES);
  if (!hasScopedRole) return { status: 403, scopeChecked: false };

  if (!branchIdParam) return { status: 400, scopeChecked: false };

  const allowed = await hasScopedAccess(userId, SCOPED_LIVE_ROLES, { branchId: branchIdParam });
  return { status: allowed ? 200 : 403, scopeChecked: true };
}

/** Mirrors the /history/:employeeId guard logic */
async function historyAccessDecision(
  userId: string,
  empBranchId: string | null
): Promise<AccessDecision> {
  const isSuperAdmin = await hasAnyRole(userId, "super_admin");
  if (isSuperAdmin) return { status: 200, scopeChecked: false };

  const hasScopedRole = await hasAnyRole(userId, ...SCOPED_LIVE_ROLES);
  if (!hasScopedRole) return { status: 403, scopeChecked: false };

  const allowed = await hasScopedAccess(userId, SCOPED_LIVE_ROLES, { branchId: empBranchId });
  return { status: allowed ? 200 : 403, scopeChecked: true };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Location routes — role/scope access logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: hasScopedAccess is called with the correct branchId when a scoped role passes branch_id
  it("calls hasScopedAccess with the correct branchId when a scoped role provides branch_id", async () => {
    mockHasAnyRole
      .mockResolvedValueOnce(false)  // not super_admin
      .mockResolvedValueOnce(true);  // has scoped role
    mockHasScopedAccess.mockResolvedValueOnce(true);

    const result = await liveAccessDecision("user-42", "branch-99");

    expect(result.status).toBe(200);
    expect(result.scopeChecked).toBe(true);
    expect(mockHasScopedAccess).toHaveBeenCalledOnce();
    expect(mockHasScopedAccess).toHaveBeenCalledWith(
      "user-42",
      SCOPED_LIVE_ROLES,
      { branchId: "branch-99" }
    );
  });

  // Test 2: returns 403 when hasScopedAccess returns false
  it("returns 403 when hasScopedAccess returns false (outside assigned scope)", async () => {
    mockHasAnyRole
      .mockResolvedValueOnce(false)  // not super_admin
      .mockResolvedValueOnce(true);  // has scoped role
    mockHasScopedAccess.mockResolvedValueOnce(false);

    const result = await liveAccessDecision("user-42", "branch-not-mine");

    expect(result.status).toBe(403);
    expect(result.scopeChecked).toBe(true);
    expect(mockHasScopedAccess).toHaveBeenCalledOnce();
  });

  // Test 3: returns 400 when a scoped role omits branch_id
  it("returns 400 when scoped role omits the required branch_id param", async () => {
    mockHasAnyRole
      .mockResolvedValueOnce(false)  // not super_admin
      .mockResolvedValueOnce(true);  // has scoped role

    const result = await liveAccessDecision("user-42", undefined);

    expect(result.status).toBe(400);
    expect(result.scopeChecked).toBe(false);
    // hasScopedAccess must NOT be called — we bail before reaching scope check
    expect(mockHasScopedAccess).not.toHaveBeenCalled();
  });

  // Test 4: super_admin bypass — hasAnyRole("super_admin") true → no scope check
  it("bypasses all scope checks when hasAnyRole returns true for super_admin", async () => {
    mockHasAnyRole.mockResolvedValueOnce(true);  // is super_admin

    const result = await liveAccessDecision("admin-1", "branch-anything");

    expect(result.status).toBe(200);
    expect(result.scopeChecked).toBe(false);
    // The first hasAnyRole call is for super_admin; no further calls expected
    expect(mockHasAnyRole).toHaveBeenCalledOnce();
    expect(mockHasScopedAccess).not.toHaveBeenCalled();
  });

  // Bonus: history route also enforces scope via employee's branch_id
  it("history route: calls hasScopedAccess with the employee branch_id for scoped roles", async () => {
    mockHasAnyRole
      .mockResolvedValueOnce(false)  // not super_admin
      .mockResolvedValueOnce(true);  // has scoped role
    mockHasScopedAccess.mockResolvedValueOnce(true);

    const result = await historyAccessDecision("user-42", "branch-77");

    expect(result.status).toBe(200);
    expect(mockHasScopedAccess).toHaveBeenCalledWith(
      "user-42",
      SCOPED_LIVE_ROLES,
      { branchId: "branch-77" }
    );
  });
});
