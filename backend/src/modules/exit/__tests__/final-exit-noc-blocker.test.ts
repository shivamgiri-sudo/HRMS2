import { describe, expect, it, vi } from "vitest";

/**
 * finalExitBlockers() must NOT gate the "exited" transition on NOC or F&F.
 *
 * Rulings:
 *   - NOC: 2026-09-16 — NOC gates money/paperwork, not the exit date itself.
 *   - F&F: 2026-09-18 — same reasoning. F&F payout is gated independently by
 *     noc-release-gate.service.ts (keyed off employees.employment_status, which this
 *     transition writes). Blocking "exited" on F&F left employees stuck active — counted
 *     in headcount, eligible for attendance and leave — while HR completed retroactive
 *     paperwork for someone who physically left weeks ago.
 *
 * Only clearance tasks remain as a gate: they represent physical handover (IT
 * deprovisioning, asset return) that must complete before the employee is inactive.
 *
 * These tests pin the two behaviours that matter now:
 *   1. Clearance tasks open → blocks.
 *   2. Clearance clean, regardless of F&F or NOC state → does NOT block.
 */

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute },
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({ requireAuth: (_r: any, _s: any, n: any) => n() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn() }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn(), hasAnyRole: vi.fn(), hasScopedAccess: vi.fn(),
}));
vi.mock("../exit.service.js", () => ({ exitService: {} }));

const EXIT_ID = "exit-req-1";

/** Prime the single clearance-count query finalExitBlockers now issues. */
function primeDb(clearanceOpenCount: number) {
  dbExecute.mockReset();
  dbExecute.mockResolvedValueOnce([[{ open_count: clearanceOpenCount }]]);
}

async function loadBlockers() {
  vi.resetModules();
  const mod: any = await import("../exit.secure.routes.js");
  return mod.__testFinalExitBlockers ?? null;
}

describe("finalExitBlockers — only clearance tasks gate the exit", () => {
  it("blocks when clearance tasks are still open", async () => {
    const finalExitBlockers = await loadBlockers();
    expect(finalExitBlockers, "finalExitBlockers must be exported for test").toBeTypeOf("function");
    primeDb(3);

    const blockers = await finalExitBlockers(EXIT_ID);
    expect(blockers.some((b: string) => b.includes("clearance task(s) still open"))).toBe(true);
  });

  it("does NOT block when all clearance tasks are done — regardless of F&F state", async () => {
    const finalExitBlockers = await loadBlockers();
    primeDb(0);

    const blockers = await finalExitBlockers(EXIT_ID);
    expect(blockers).toEqual([]);
  });

  it("does NOT block on missing/unapproved F&F (ruling 2026-09-18)", async () => {
    const finalExitBlockers = await loadBlockers();
    primeDb(0);

    const blockers = await finalExitBlockers(EXIT_ID);
    expect(blockers.some((b: string) => /f&f|full.{0,5}final/i.test(b))).toBe(false);
  });

  it("does NOT block on NOC (ruling 2026-09-16)", async () => {
    const finalExitBlockers = await loadBlockers();
    primeDb(0);

    const blockers = await finalExitBlockers(EXIT_ID);
    expect(blockers.some((b: string) => /noc/i.test(b))).toBe(false);
  });

  it("issues exactly one DB query — no F&F or NOC lookups", async () => {
    const finalExitBlockers = await loadBlockers();
    primeDb(0);

    await finalExitBlockers(EXIT_ID);
    expect(dbExecute).toHaveBeenCalledTimes(1);
  });
});
