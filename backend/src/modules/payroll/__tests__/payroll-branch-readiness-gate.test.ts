/**
 * Guard tests for the payroll run-creation readiness gate.
 *
 * WHAT WENT WRONG
 * ---------------
 * On 2026-08-17 no August 2026 payroll run existed, and none could be created. The page and
 * every dashboard tile therefore had nothing to render. The cause was not the UI: it was a
 * circular dependency in this gate.
 *
 * `createRun()` refuses to create a run unless every active branch is ready, and a branch is
 * ready only if attendance is frozen. But `attendance_frozen` was derived by reading
 * `attendance_snapshot_locked` off the salary_prep_run FOR THAT MONTH — the run that does not
 * exist yet — and `freezeAttendance(runId)` takes a runId, so freezing is something done to a
 * run that already exists.
 *
 *     to create a run you need attendance frozen; to freeze attendance you need a run.
 *
 * Verified live: 0 of 74 rows in payroll_branch_readiness have ever had attendance_frozen=1,
 * ho_override_ready=1, or readiness_status='ready' — in any month, ever. July 2026 only exists
 * because it was created 20 days before the readiness table held its first row.
 *
 * Two separate defects kept the deadlock shut, and each has a test below:
 *
 *   1. The documented escape hatch was dead code. validatePayrollRunCreation computed
 *      `isReady` (which honours ho_override_ready) and then ANDed it with `!isBlocked`, where
 *      `isBlocked` was true whenever `attendance_frozen === 0` on its own. So an overridden
 *      branch was isReady=true AND isBlocked=true, and landed in `blocked` — while the error
 *      message told the user to apply the very override that could not work.
 *
 *   2. `readiness_status === 'ready'` was itself unreachable: computeStatus only returned
 *      'ready' when `frozen === 1`, the same flag that could never be set.
 *
 * WHY BOTH DIRECTIONS ARE ASSERTED
 *   A gate is only worth having if it still goes red. Every case below is pinned in both
 *   directions — an overridden branch must pass AND an unprepared branch must still be
 *   blocked — so neither a hardcoded `ready` nor a hardcoded `blocked` would satisfy these.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const execute = vi.fn();

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => execute(...args) },
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn(async () => undefined),
}));

vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({
  triggerPayrollBranchSignOff: vi.fn(async () => undefined),
  triggerPayrollProcessSignOff: vi.fn(async () => undefined),
  triggerPayrollProcessFreezeRequest: vi.fn(async () => undefined),
}));

/** min_readiness_score. The gate's threshold is policy-driven; 80 is the shipped default. */
let minReadinessScore = "80";
vi.mock("../../policy-engine/policy-engine.cache.js", () => ({
  getPolicyValue: vi.fn(async () => minReadinessScore),
}));

const { payrollBranchReadinessService } = await import("../payroll-branch-readiness.service.js");

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** The seven branches that are active in production. Only the shape matters here. */
const ACTIVE_BRANCHES = [
  { id: "b-noida", branch_name: "NOIDA" },
  { id: "b-noida2", branch_name: "NOIDA-2" },
];

type ReadinessShape = {
  attendance_frozen: number;
  ho_override_ready: number;
  readiness_status: string;
};

/**
 * Stub getOrRefresh per branch. It is the seam the gate reads through, and standing up its
 * real body would mean faking ~20 unrelated metric queries to assert one boolean.
 */
function stubReadiness(byBranch: Record<string, ReadinessShape>) {
  return vi
    .spyOn(payrollBranchReadinessService, "getOrRefresh")
    .mockImplementation(async (_month: string, branchId: string) => {
      const rec = byBranch[branchId];
      if (!rec) throw new Error(`no fixture for ${branchId}`);
      return rec as never;
    });
}

beforeEach(() => {
  vi.restoreAllMocks();
  execute.mockReset();
  minReadinessScore = "80";
  // branch_master lookup inside validatePayrollRunCreation
  execute.mockResolvedValue([ACTIVE_BRANCHES, []]);
});

// ─── validatePayrollRunCreation ──────────────────────────────────────────────

describe("validatePayrollRunCreation", () => {
  it("admits a branch carrying an HO override even though attendance is not frozen", async () => {
    // The exact live shape of every August 2026 row, plus the override an authorised
    // payroll_head applied. Before the fix this returned blocked=[NOIDA, NOIDA-2] and
    // createRun threw, which is what made August impossible to create.
    stubReadiness({
      "b-noida": { attendance_frozen: 0, ho_override_ready: 1, readiness_status: "blocked" },
      "b-noida2": { attendance_frozen: 0, ho_override_ready: 1, readiness_status: "blocked" },
    });

    const result = await payrollBranchReadinessService.validatePayrollRunCreation("2026-08");

    expect(result.blocked).toEqual([]);
    expect(result.ready).toEqual(["NOIDA", "NOIDA-2"]);
  });

  it("admits a branch that is genuinely frozen and ready", async () => {
    stubReadiness({
      "b-noida": { attendance_frozen: 1, ho_override_ready: 0, readiness_status: "ready" },
      "b-noida2": { attendance_frozen: 1, ho_override_ready: 0, readiness_status: "ready" },
    });

    const result = await payrollBranchReadinessService.validatePayrollRunCreation("2026-08");

    expect(result.blocked).toEqual([]);
    expect(result.ready).toEqual(["NOIDA", "NOIDA-2"]);
  });

  it("still blocks a branch with no override, no freeze and no readiness", async () => {
    // The other direction. Relaxing the gate must not turn it into a rubber stamp.
    stubReadiness({
      "b-noida": { attendance_frozen: 0, ho_override_ready: 0, readiness_status: "blocked" },
      "b-noida2": { attendance_frozen: 0, ho_override_ready: 0, readiness_status: "in_progress" },
    });

    const result = await payrollBranchReadinessService.validatePayrollRunCreation("2026-08");

    expect(result.ready).toEqual([]);
    expect(result.blocked).toEqual(["NOIDA", "NOIDA-2"]);
  });

  it("blocks only the branches that are not ready, not the whole company", async () => {
    stubReadiness({
      "b-noida": { attendance_frozen: 0, ho_override_ready: 1, readiness_status: "blocked" },
      "b-noida2": { attendance_frozen: 0, ho_override_ready: 0, readiness_status: "blocked" },
    });

    const result = await payrollBranchReadinessService.validatePayrollRunCreation("2026-08");

    expect(result.ready).toEqual(["NOIDA"]);
    expect(result.blocked).toEqual(["NOIDA-2"]);
  });

  it("fails closed when a branch's readiness cannot be read", async () => {
    // A thrown query here reads as "not ready", which is the safe direction — but it used to
    // do so silently. The collation of payroll_branch_readiness.branch_id (utf8mb4_0900_ai_ci)
    // differs from branch_master.id (utf8mb4_unicode_ci), so an unguarded join raises
    // ER_CANT_AGGREGATE_2COLLATIONS and would be indistinguishable from an unprepared branch.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(payrollBranchReadinessService, "getOrRefresh").mockImplementation(async () => {
      throw new Error("Illegal mix of collations");
    });

    const result = await payrollBranchReadinessService.validatePayrollRunCreation("2026-08");

    expect(result.ready).toEqual([]);
    expect(result.blocked).toEqual(["NOIDA", "NOIDA-2"]);
    // The error must be visible, not swallowed into an ordinary "branch not ready".
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c.join(" ")).includes("Illegal mix of collations"))).toBe(true);
  });

  it("returns neither ready nor blocked when the branch list cannot be read", async () => {
    execute.mockRejectedValue(new Error("ER_NO_SUCH_TABLE: branch_master"));

    const result = await payrollBranchReadinessService.validatePayrollRunCreation("2026-08");

    expect(result).toEqual({ blocked: [], ready: [] });
  });
});

// ─── computeStatus ───────────────────────────────────────────────────────────

describe("computeStatus", () => {
  it("reaches 'ready' on score alone, without the unreachable freeze flag", async () => {
    // attendance_frozen is a post-creation control — freezeAttendance() needs a runId — so
    // gating 'ready' on it made 'ready' unreachable for every branch in every month.
    expect(await payrollBranchReadinessService.computeStatus(85, 0, 0)).toBe("ready");
  });

  it("treats an HO override as ready regardless of score", async () => {
    expect(await payrollBranchReadinessService.computeStatus(5, 0, 1)).toBe("ready");
  });

  it("does not call a branch ready below the policy threshold", async () => {
    // Other direction: the score still has to be earned.
    expect(await payrollBranchReadinessService.computeStatus(79, 0, 0)).not.toBe("ready");
    expect(await payrollBranchReadinessService.computeStatus(60, 1, 0)).not.toBe("ready");
  });

  it("honours a policy threshold other than the default", async () => {
    minReadinessScore = "90";
    expect(await payrollBranchReadinessService.computeStatus(85, 0, 0)).not.toBe("ready");
    minReadinessScore = "70";
    expect(await payrollBranchReadinessService.computeStatus(85, 0, 0)).toBe("ready");
  });

  it("still reports blocked and in_progress at the low end", async () => {
    // Only the 'ready' limb changes. The lower bands are left exactly as they were, so a
    // branch that has done nothing still reads as blocked rather than quietly passing.
    expect(await payrollBranchReadinessService.computeStatus(0, 0, 0)).toBe("blocked");
    expect(await payrollBranchReadinessService.computeStatus(20, 0, 0)).toBe("blocked");
    expect(await payrollBranchReadinessService.computeStatus(60, 0, 0)).toBe("in_progress");
  });
});
