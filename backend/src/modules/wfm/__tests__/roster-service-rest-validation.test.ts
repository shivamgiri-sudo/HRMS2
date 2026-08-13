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

const { isRestPolicyFeatureActive, validateMinimumRest, logRestOverride, withEmployeeRosterLock } = vi.hoisted(() => ({
  isRestPolicyFeatureActive: vi.fn(),
  validateMinimumRest: vi.fn(),
  logRestOverride: vi.fn().mockResolvedValue(undefined),
  // Passthrough: the lock's own acquire/release behavior is covered by
  // rest-policy.test.ts directly. Here, `conn` is just `{ execute }` — the
  // same mocked execute the rest of this file already configures — so every
  // existing assertion against `execute.mock.calls` still sees the calls
  // assignEmployee makes "through the lock connection".
  withEmployeeRosterLock: vi.fn((_employeeId: string, fn: (conn: { execute: typeof execute }) => unknown) => fn({ execute })),
}));
vi.mock("../rest-policy.service.js", () => ({ isRestPolicyFeatureActive, validateMinimumRest, logRestOverride, withEmployeeRosterLock }));

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
