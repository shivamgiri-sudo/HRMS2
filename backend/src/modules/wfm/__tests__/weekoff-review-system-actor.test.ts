import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  hasRole: vi.fn(async () => false),
  getEmployeeForUser: vi.fn(async () => null),
  lock: vi.fn(async () => ({ blocked: false })),
  notify: vi.fn(async () => {}),
  exec: vi.fn(async () => [[], []]),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: m.exec,
    getConnection: async () => ({
      beginTransaction: async () => {},
      execute: m.exec,
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
  },
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: m.hasRole, getEmployeeForUser: m.getEmployeeForUser }));
vi.mock("../../roster/roster-lock-guard.js", () => ({ checkAssignmentDateNotLocked: m.lock }));
vi.mock("../../roster-requests/roster-requests.notify.js", () => ({ notifyWeekoffDecision: m.notify }));

import { forceApproveWeekoff } from "../weekoff-review.service.js";

describe("weekoff review — system actor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a non-privileged user without an employee record is still refused (unchanged)", async () => {
    await expect(forceApproveWeekoff({ assignmentId: "a1", userId: "u1", body: { reason: "r" } }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("systemActor skips the manager-scope check but keeps the lock check", async () => {
    const res = await forceApproveWeekoff({ assignmentId: "a1", userId: "system:auto-approve", body: { reason: "r" }, systemActor: true });
    expect(res.finalRosterStatus).toBe("force_approved_by_manager");
    expect(m.getEmployeeForUser).not.toHaveBeenCalled();
    expect(m.lock).toHaveBeenCalled();
  });

  it("systemActor still refuses a locked date", async () => {
    m.lock.mockResolvedValueOnce({ blocked: true, error: "locked" } as any);
    await expect(forceApproveWeekoff({ assignmentId: "a1", userId: "system:auto-approve", body: { reason: "r" }, systemActor: true }))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});
