import { describe, expect, it, vi } from "vitest";

/**
 * The "exited" transition is gated by nothing but the FSM edge.
 *
 * Rulings:
 *   - NOC: 2026-09-16 — NOC gates money/paperwork, not the exit date itself.
 *   - F&F: 2026-09-18 — same reasoning.
 *   - Clearance: 2026-09-26 — generate clearance must not block the exit gate either.
 *     Open tasks are only counted and reported (`pendingAtExit`); they keep blocking
 *     F&F approval (ff-approval-guard.compat.routes.ts) and the NOC-gated payout steps.
 *
 * openClearanceAtExit() therefore returns a count and never throws a blocker.
 */

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute },
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (_r: any, _s: any, n: any) => n(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn(),
  hasAnyRole: vi.fn(),
  hasScopedAccess: vi.fn(),
}));
vi.mock("../exit.service.js", () => ({ exitService: {} }));

const EXIT_ID = "exit-req-1";

function primeDb(clearanceOpenCount: number) {
  dbExecute.mockReset();
  dbExecute.mockResolvedValueOnce([[{ open_count: clearanceOpenCount }]]);
}

async function loadCounter() {
  vi.resetModules();
  const mod: any = await import("../exit.secure.routes.js");
  return mod.__testOpenClearanceAtExit ?? null;
}

describe("openClearanceAtExit — reports open clearance, never blocks exit", () => {
  it("returns the open task count so the API can report pendingAtExit", async () => {
    const openClearanceAtExit = await loadCounter();
    expect(openClearanceAtExit).toBeTypeOf("function");
    primeDb(3);

    await expect(openClearanceAtExit(EXIT_ID)).resolves.toBe(3);
  });

  it("returns 0 when all clearance tasks are cleared or waived", async () => {
    const openClearanceAtExit = await loadCounter();
    primeDb(0);

    await expect(openClearanceAtExit(EXIT_ID)).resolves.toBe(0);
  });

  it("issues exactly one DB query — no F&F or NOC lookups", async () => {
    const openClearanceAtExit = await loadCounter();
    primeDb(0);

    await openClearanceAtExit(EXIT_ID);
    expect(dbExecute).toHaveBeenCalledTimes(1);
  });
});
