import { describe, expect, it, vi } from "vitest";

/**
 * finalExitBlockers() must NOT gate the final "exited" transition on NOC (2026-09-16, reversing
 * the 2026-08-27 change this file used to pin).
 *
 * NOC gates money and paperwork, not the exit date/status itself — F&F payout is gated
 * independently by noc-release-gate.service.ts (keyed off employees.employment_status, which
 * this transition itself writes), and the experience/relieving letter is gated independently in
 * the letters module. Blocking the "exited" transition on NOC left an employee stuck active —
 * no exit date, active_status still 1 — for however long NOC took, even after every clearance
 * task was done and F&F was approved.
 *
 * These tests pin the two behaviours that matter now:
 *   1. Clearance tasks open, or F&F not approved/provisional -> still blocks (unchanged).
 *   2. NOC missing/invalid, with clearance and F&F both clean -> does NOT block, and
 *      noc.service.ts is never even imported/consulted by this function.
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

/**
 * finalExitBlockers is module-private, so drive it through the two queries it issues, in order:
 * open clearance tasks, then the latest F&F row. There is no third (employee_id/NOC) query
 * anymore — a test below asserts exactly that.
 */
function primeDb(clearanceOpenCount: number, ff: { status: string; is_ff_provisional: number } | null) {
  dbExecute.mockReset();
  dbExecute
    .mockResolvedValueOnce([[{ open_count: clearanceOpenCount }]])
    .mockResolvedValueOnce([ff ? [ff] : []]);
}

async function loadBlockers() {
  vi.resetModules();
  const mod: any = await import("../exit.secure.routes.js");
  return mod.__testFinalExitBlockers ?? null;
}

describe("finalExitBlockers — NOC is not a gate here", () => {
  it("blocks when clearance tasks are still open", async () => {
    const finalExitBlockers = await loadBlockers();
    expect(finalExitBlockers, "finalExitBlockers must be exported for test").toBeTypeOf("function");
    primeDb(2, { status: "approved", is_ff_provisional: 0 });

    const blockers = await finalExitBlockers(EXIT_ID);
    expect(blockers.some((b: string) => b.includes("clearance task(s) still open"))).toBe(true);
  });

  it("blocks when F&F is missing, not approved, or still provisional", async () => {
    const finalExitBlockers = await loadBlockers();
    primeDb(0, null);
    expect((await finalExitBlockers(EXIT_ID)).some((b: string) => b.includes("F&F calculation is missing"))).toBe(true);

    primeDb(0, { status: "pending", is_ff_provisional: 0 });
    expect((await finalExitBlockers(EXIT_ID)).some((b: string) => b.includes("F&F is pending"))).toBe(true);

    primeDb(0, { status: "approved", is_ff_provisional: 1 });
    expect((await finalExitBlockers(EXIT_ID)).some((b: string) => b.includes("F&F is provisional"))).toBe(true);
  });

  it("does NOT block on a missing/invalid NOC once clearance and F&F are clean", async () => {
    const finalExitBlockers = await loadBlockers();
    primeDb(0, { status: "approved", is_ff_provisional: 0 });

    const blockers = await finalExitBlockers(EXIT_ID);

    expect(blockers).toEqual([]);
    expect(blockers.some((b: string) => /noc/i.test(b))).toBe(false);
    // Only the clearance-task and F&F queries run — no third query looking up the employee
    // for a NOC check.
    expect(dbExecute).toHaveBeenCalledTimes(2);
  });
});
