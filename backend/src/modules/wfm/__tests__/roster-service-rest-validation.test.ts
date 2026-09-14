import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * roster.service.ts's assignEmployee() is the manual-assignment write path —
 * Area 2 requires it to block on insufficient rest by default, and only
 * proceed via an explicit emergency override (reason + approver) when the
 * resolved policy allows it. rest-policy.service.ts's own resolver/gap-math
 * logic is covered by rest-policy.test.ts; this file is scoped to
 * assignEmployee's decision logic given each of validateMinimumRest's
 * possible outcomes.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { isRestPolicyFeatureActive, validateMinimumRest, logRestOverride, withEmployeeRosterLock, applyRestDecision } = vi.hoisted(() => ({
  isRestPolicyFeatureActive: vi.fn(),
  validateMinimumRest: vi.fn(),
  logRestOverride: vi.fn().mockResolvedValue(undefined),
  // Passthrough: the lock's own acquire/release behavior is covered by
  // rest-policy.test.ts directly. Here, `conn` is just `{ execute }` — the
  // same mocked execute the rest of this file already configures — so every
  // existing assertion against `execute.mock.calls` still sees the calls
  // assignEmployee makes "through the lock connection".
  withEmployeeRosterLock: vi.fn((_employeeId: string, fn: (conn: { execute: typeof execute }) => unknown) => fn({ execute })),
  // Mirrors applyRestDecision's real allow/warn logic (rest-policy-warn-mode.test.ts covers
  // that function's own internals — recording the warning, blocking REST_POLICY_MISSING
  // unconditionally, etc.). This file is scoped to assignEmployee's orchestration: does it
  // call the shared decision point at all, and does it respect what comes back.
  applyRestDecision: vi.fn(async (result: { ok: boolean; reason?: string; policy?: { enforcementMode?: string } }) => {
    if (result.ok) return { allowed: true, warned: false };
    if (result.reason !== "INSUFFICIENT_REST") return { allowed: false, warned: false };
    if (result.policy?.enforcementMode !== "warn") return { allowed: false, warned: false };
    return { allowed: true, warned: true };
  }),
}));
vi.mock("../rest-policy.service.js", () => ({ isRestPolicyFeatureActive, validateMinimumRest, logRestOverride, withEmployeeRosterLock, applyRestDecision }));

vi.mock("../shift-scheduling.util.js", () => ({
  computeScheduledMinutes: vi.fn().mockReturnValue(480),
  rosterAssignmentColumns: vi.fn().mockResolvedValue(new Set(["id", "employee_id"])), // no versioning cols
}));

import { rosterService, InsufficientRestError, RestPolicyMissingError } from "../roster.service.js";

const BASE_INPUT = {
  employeeId: "emp-1", rosterDate: "2026-08-17", shiftId: "shift-1",
  shiftStartTime: "09:00", shiftEndTime: "18:00",
};

beforeEach(() => {
  execute.mockReset();
  isRestPolicyFeatureActive.mockReset();
  validateMinimumRest.mockReset();
  logRestOverride.mockClear();
  applyRestDecision.mockClear();
  // Default: employee lookup returns a process/branch, then the final
  // SELECT * FROM wfm_roster_assignment (post-insert re-fetch) returns a row.
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT process_id, branch_id FROM employees")) return [[{ process_id: "proc-1", branch_id: "branch-1" }], []];
    if (sql.startsWith("SELECT * FROM wfm_roster_assignment")) return [[{ id: "assignment-1" }], []];
    return [[], []];
  });
});

describe("assignEmployee - Area 2 minimum rest", () => {
  it("skips validation entirely when the rest-policy feature is not active (migration not applied) -- preserves current behavior", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(false);
    await rosterService.assignEmployee(BASE_INPUT, "user-1");
    expect(validateMinimumRest).not.toHaveBeenCalled();
  });

  it("skips validation when the input has no shift times (e.g. a week-off assignment)", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    await rosterService.assignEmployee({ ...BASE_INPUT, shiftStartTime: null, shiftEndTime: null }, "user-1");
    expect(validateMinimumRest).not.toHaveBeenCalled();
  });

  it("proceeds with the insert when the rest check is ok", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue({ ok: true });
    const result = await rosterService.assignEmployee(BASE_INPUT, "user-1");
    expect(result).toBeDefined();
    const insertCall = execute.mock.calls.find(([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"));
    expect(insertCall).toBeDefined();
  });

  it("throws RestPolicyMissingError and never inserts when no policy resolves", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue({ ok: false, reason: "REST_POLICY_MISSING", policy: null });
    await expect(rosterService.assignEmployee(BASE_INPUT, "user-1")).rejects.toThrow(RestPolicyMissingError);
    const insertCall = execute.mock.calls.find(([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"));
    expect(insertCall).toBeUndefined();
  });

  it("throws InsufficientRestError and never inserts when below minimum and no override is supplied", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue({
      ok: false, reason: "INSUFFICIENT_REST", against: "previous", actualRestMinutes: 300,
      requiredRestMinutes: 600, canOverride: true, neighborShift: { date: "2026-08-16", time: "18:00" },
    });
    await expect(rosterService.assignEmployee(BASE_INPUT, "user-1")).rejects.toThrow(InsufficientRestError);
    expect(logRestOverride).not.toHaveBeenCalled();
    const insertCall = execute.mock.calls.find(([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"));
    expect(insertCall).toBeUndefined();
  });

  it("blocks even with a reason+approver when the resolved policy does not allow override", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue({
      ok: false, reason: "INSUFFICIENT_REST", against: "previous", actualRestMinutes: 300,
      requiredRestMinutes: 600, canOverride: false, neighborShift: { date: "2026-08-16", time: "18:00" },
    });
    await expect(rosterService.assignEmployee(
      { ...BASE_INPUT, restOverrideReason: "Urgent coverage", restOverrideApprovedBy: "manager-1" }, "user-1"
    )).rejects.toThrow(InsufficientRestError);
    expect(logRestOverride).not.toHaveBeenCalled();
  });

  it("proceeds and logs an immutable audit row when canOverride is true and both reason+approver are supplied", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue({
      ok: false, reason: "INSUFFICIENT_REST", against: "previous", actualRestMinutes: 300,
      requiredRestMinutes: 600, canOverride: true, neighborShift: { date: "2026-08-16", time: "18:00" },
      policy: { id: "policy-1", scopeType: "organization", scopeId: null, minimumRestMinutes: 600, allowsEmergencyOverride: true },
    });
    const result = await rosterService.assignEmployee(
      { ...BASE_INPUT, restOverrideReason: "Urgent coverage gap", restOverrideApprovedBy: "manager-1" }, "requester-1"
    );
    expect(result).toBeDefined();
    expect(logRestOverride).toHaveBeenCalledTimes(1);
    const call = logRestOverride.mock.calls[0][0];
    expect(call.reason).toBe("Urgent coverage gap");
    expect(call.approvedBy).toBe("manager-1");
    expect(call.requestedBy).toBe("requester-1");
    expect(call.source).toBe("manual_assignment");
    expect(call.policyId).toBe("policy-1");
    // against "previous" -> the neighbor is the previous shift's own end time
    expect(call.previousShiftEndAt).toBe("2026-08-16 18:00:00");
    expect(call.nextShiftStartAt).toBe("2026-08-17 09:00:00");

    const insertCall = execute.mock.calls.find(([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"));
    expect(insertCall, "override should still result in the assignment being written").toBeDefined();
  });

  it("requires BOTH reason and approver -- a reason alone is not sufficient to override", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue({
      ok: false, reason: "INSUFFICIENT_REST", against: "previous", actualRestMinutes: 300,
      requiredRestMinutes: 600, canOverride: true, neighborShift: { date: "2026-08-16", time: "18:00" },
    });
    await expect(rosterService.assignEmployee(
      { ...BASE_INPUT, restOverrideReason: "Urgent coverage gap" /* no approver */ }, "user-1"
    )).rejects.toThrow(InsufficientRestError);
    expect(logRestOverride).not.toHaveBeenCalled();
  });
});

describe("assignEmployee - WARN mode (Section E audit fix, 2026-08-17)", () => {
  // Previously this was the only one of five roster write paths that never consulted
  // applyRestDecision — it always threw InsufficientRestError on a shortfall regardless of
  // enforcementMode, ignoring WARN entirely. Fixed to call the same shared decision point
  // generation/bulk-upload/swap already use.
  const warnShortfall = {
    ok: false as const, reason: "INSUFFICIENT_REST" as const, against: "previous" as const,
    actualRestMinutes: 300, requiredRestMinutes: 600, canOverride: false,
    neighborShift: { date: "2026-08-16", time: "18:00" },
    policy: { id: "policy-1", scopeType: "organization" as const, scopeId: null, minimumRestMinutes: 600, allowsEmergencyOverride: false, enforcementMode: "warn" as const },
  };

  it("consults the shared decision point on every INSUFFICIENT_REST, not just an internal check", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue(warnShortfall);
    await rosterService.assignEmployee(BASE_INPUT, "user-1");
    expect(applyRestDecision).toHaveBeenCalledTimes(1);
    expect(applyRestDecision.mock.calls[0][0]).toBe(warnShortfall);
  });

  it("proceeds with the insert in WARN mode even with no override reason/approver supplied", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue(warnShortfall);
    const result = await rosterService.assignEmployee(BASE_INPUT, "user-1");
    expect(result).toBeDefined();
    const insertCall = execute.mock.calls.find(([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"));
    expect(insertCall, "WARN mode must not block the write").toBeDefined();
  });

  it("does not fall through to the emergency-override path in WARN mode -- no audit-override row is logged", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue(warnShortfall);
    await rosterService.assignEmployee(BASE_INPUT, "user-1");
    // WARN is a policy state, not a per-assignment override -- applyRestDecision's own
    // recordRestGapWarning (covered in rest-policy-warn-mode.test.ts) is what persists the
    // shortfall, not this file's logRestOverride audit trail.
    expect(logRestOverride).not.toHaveBeenCalled();
  });

  it("still blocks in BLOCK mode with no override supplied, unchanged from before this fix", async () => {
    isRestPolicyFeatureActive.mockResolvedValue(true);
    validateMinimumRest.mockResolvedValue({
      ...warnShortfall,
      policy: { ...warnShortfall.policy, enforcementMode: "block" as const },
    });
    await expect(rosterService.assignEmployee(BASE_INPUT, "user-1")).rejects.toThrow(InsufficientRestError);
  });
});
