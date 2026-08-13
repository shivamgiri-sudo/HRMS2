import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round 2 governance-matrix finding (2026-08-13): roster.service.ts's
 * assignEmployee() was the only one of the four real roster-write engines
 * with no audit trail at all — roster-generation.service.ts writes
 * roster_decision_audit per employee/date, auto-roster-synced.service.ts has
 * its own wfm_roster_event_log, this had neither.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

const { withEmployeeRosterLock } = vi.hoisted(() => ({
  withEmployeeRosterLock: vi.fn((_employeeId: string, fn: (conn: { execute: typeof execute }) => unknown) => fn({ execute })),
}));
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn().mockResolvedValue(false),
  validateMinimumRest: vi.fn(),
  logRestOverride: vi.fn().mockResolvedValue(undefined),
  withEmployeeRosterLock,
}));

vi.mock("../shift-scheduling.util.js", () => ({
  computeScheduledMinutes: vi.fn().mockReturnValue(480),
  rosterAssignmentColumns: vi.fn().mockResolvedValue(new Set(["id", "employee_id"])),
}));

import { rosterService } from "../roster.service.js";

const BASE_INPUT = { employeeId: "emp-1", rosterDate: "2026-08-17", shiftId: "shift-1", planId: "plan-1" };

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockClear();
  execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT * FROM wfm_roster_assignment")) return [[{ id: "assignment-1" }], []];
    return [[], []];
  });
});

describe("assignEmployee — audit trail (round 2 governance-matrix gap)", () => {
  it("logs a WFM_ROSTER_ASSIGNMENT_UPSERTED audit entry after a successful assignment", async () => {
    await rosterService.assignEmployee(BASE_INPUT, "user-1");
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: "user-1",
        action_type: "WFM_ROSTER_ASSIGNMENT_UPSERTED",
        entity_type: "wfm_roster_assignment",
        entity_id: "assignment-1",
        change_summary: expect.objectContaining({
          employee_id: "emp-1",
          roster_date: "2026-08-17",
          shift_id: "shift-1",
          plan_id: "plan-1",
        }),
      })
    );
  });

  it("does not fail the assignment if the audit write itself fails", async () => {
    logSensitiveAction.mockRejectedValueOnce(new Error("audit log db unavailable"));
    await expect(rosterService.assignEmployee(BASE_INPUT, "user-1")).resolves.toMatchObject({ id: "assignment-1" });
  });
});
