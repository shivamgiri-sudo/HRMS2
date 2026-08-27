import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * NOC must block the final "exited" transition (2026-08-27).
 *
 * noc.service.ts has exported nocValidated() since it was written, and a repo-wide search
 * found ZERO callers: the upload/validate workflow recorded a decision nothing downstream
 * consulted. F&F approval and disbursal contained no NOC reference at all, so a leaver could
 * be marked exited — and settled — with the NOC missing or rejected, while every operational
 * doc described NOC as the gate on release.
 *
 * These tests pin the three behaviours that matter:
 *   1. NOC required + not validated  -> blocker present (this fails without the fix)
 *   2. NOC required + validated      -> no NOC blocker
 *   3. NOC not required              -> no NOC blocker, and nocValidated is never consulted
 *      (so the gate cannot fire for a leaver the business never wanted a NOC from)
 *
 * Plus the deliberate non-fatal case: a throwing NOC lookup must NOT block the exit, because
 * refusing every exit on a failed query is a worse outage than the gap being closed.
 */

const { dbExecute, nocRequiredMock, nocValidatedMock } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  nocRequiredMock: vi.fn(),
  nocValidatedMock: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute },
}));
vi.mock("../../payroll/noc.service.js", () => ({
  nocRequired: nocRequiredMock,
  nocValidated: nocValidatedMock,
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({ requireAuth: (_r: any, _s: any, n: any) => n() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn() }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn(), hasAnyRole: vi.fn(), hasScopedAccess: vi.fn(),
}));
vi.mock("../exit.service.js", () => ({ exitService: {} }));

const EXIT_ID = "exit-req-1";
const EMP_ID = "emp-1";

/**
 * finalExitBlockers is module-private, so drive it through the same three queries it issues,
 * in order: open clearance tasks, latest F&F row, then the exit_request -> employee_id lookup
 * this fix added. Everything upstream is set to "clean" so the only blocker that can appear
 * is the NOC one under test.
 */
function primeCleanExit() {
  dbExecute.mockReset();
  dbExecute
    .mockResolvedValueOnce([[{ open_count: 0 }]])                                  // clearance
    .mockResolvedValueOnce([[{ status: "approved", is_ff_provisional: 0 }]])       // F&F
    .mockResolvedValueOnce([[{ employee_id: EMP_ID }]]);                           // employee lookup
}

async function loadBlockers() {
  vi.resetModules();
  const mod: any = await import("../exit.secure.routes.js");
  return mod.__testFinalExitBlockers ?? null;
}

describe("finalExitBlockers — NOC gate", () => {
  beforeEach(() => {
    nocRequiredMock.mockReset();
    nocValidatedMock.mockReset();
  });

  it("blocks the exit when a NOC is required and not validated", async () => {
    const finalExitBlockers = await loadBlockers();
    expect(finalExitBlockers, "finalExitBlockers must be exported for test").toBeTypeOf("function");
    primeCleanExit();
    nocRequiredMock.mockResolvedValue({ required: true, reason: "FNF settlement pending" });
    nocValidatedMock.mockResolvedValue(false);

    const blockers = await finalExitBlockers(EXIT_ID);

    expect(blockers.some((b: string) => b.includes("NOC not validated"))).toBe(true);
    expect(blockers.some((b: string) => b.includes("FNF settlement pending"))).toBe(true);
    expect(nocValidatedMock).toHaveBeenCalledWith(EMP_ID, "fnf");
  });

  it("allows the exit when the required NOC is validated", async () => {
    const finalExitBlockers = await loadBlockers();
    primeCleanExit();
    nocRequiredMock.mockResolvedValue({ required: true, reason: "FNF settlement pending" });
    nocValidatedMock.mockResolvedValue(true);

    expect(await finalExitBlockers(EXIT_ID)).toEqual([]);
  });

  it("never consults NOC validation when no NOC is required", async () => {
    const finalExitBlockers = await loadBlockers();
    primeCleanExit();
    nocRequiredMock.mockResolvedValue({ required: false, reason: null });

    expect(await finalExitBlockers(EXIT_ID)).toEqual([]);
    expect(nocValidatedMock).not.toHaveBeenCalled();
  });

  it("does not block the exit when the NOC lookup itself throws", async () => {
    const finalExitBlockers = await loadBlockers();
    primeCleanExit();
    nocRequiredMock.mockRejectedValue(new Error("connection lost"));

    expect(await finalExitBlockers(EXIT_ID)).toEqual([]);
  });
});
