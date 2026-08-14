import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TAT_BREACH was a registered Work Inbox item_type with a fully-written trigger function
 * (triggerTatBreach in work-inbox.triggers.ts) that nothing ever called — confirmed live,
 * zero work_item rows of this type ever existed (delta-audit 2026-08-14, Stage 7b,
 * user-approved: wire up the producers that already have code, leave the rest as a known
 * gap). runTatEscalationSweep is the one place a TAT instance is confirmed to have actually
 * breached (right after markBreached), so it's the correct trigger point.
 */

const { findDueEscalations, recordEscalation, markBreached } = vi.hoisted(() => ({
  findDueEscalations: vi.fn(),
  recordEscalation: vi.fn(),
  markBreached: vi.fn(),
}));
vi.mock("../../modules/governance/tat.service.js", () => ({ findDueEscalations, recordEscalation, markBreached }));

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("../../modules/communication/notification.gateway.js", () => ({ notificationGateway: { notify } }));

const { triggerTatBreach } = vi.hoisted(() => ({ triggerTatBreach: vi.fn() }));
vi.mock("../../modules/work-inbox/work-inbox.triggers.js", () => ({ triggerTatBreach }));

vi.mock("../../db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));
vi.mock("../../shared/worker-config.js", () => ({
  isWorkerEnabled: vi.fn().mockResolvedValue(true),
  markWorkerRun: vi.fn(),
}));
vi.mock("../worker-utils.js", () => ({
  withWorkerLock: (name: string, fn: () => Promise<unknown>) => fn(),
  registerTimer: vi.fn(),
  unregisterTimer: vi.fn(),
  recordWorkerRun: vi.fn(),
}));

const { runTatEscalationSweep } = await import("../tat-escalation.worker.js");

const ESCALATION = {
  tatInstanceId: "tat-1",
  taskType: "onboarding_review",
  entityType: "candidate",
  entityId: "cand-1",
  assignedTo: "emp-1",
  ownerUserId: "user-1",
  branchId: "branch-1",
  processId: null,
  dueAt: new Date("2026-08-14T00:00:00Z"),
  escalationLevel: 1,
  notifyRole: "hr",
  notifyUserId: null,
  escalationAction: "notify",
  hoursOverdue: 5,
};

beforeEach(() => {
  findDueEscalations.mockReset().mockResolvedValue([ESCALATION]);
  recordEscalation.mockReset().mockResolvedValue(true);
  markBreached.mockReset().mockResolvedValue(undefined);
  notify.mockReset().mockResolvedValue({ outcome: "shadow" });
  triggerTatBreach.mockReset().mockResolvedValue(undefined);
});

describe("runTatEscalationSweep creates a Work Inbox TAT_BREACH item", () => {
  it("calls triggerTatBreach after marking the instance breached, with the escalation's own fields", async () => {
    await runTatEscalationSweep();

    expect(markBreached).toHaveBeenCalledWith("tat-1");
    expect(triggerTatBreach).toHaveBeenCalledWith("tat-1", "onboarding_review", "cand-1", "hr");
    // markBreached must run first — the trigger asserts a genuine breach, not a pending one.
    const breachOrder = markBreached.mock.invocationCallOrder[0];
    const triggerOrder = triggerTatBreach.mock.invocationCallOrder[0];
    expect(breachOrder).toBeLessThan(triggerOrder);
  });

  it("does not call triggerTatBreach when the escalation level was already claimed by another worker", async () => {
    recordEscalation.mockResolvedValue(false);

    await runTatEscalationSweep();

    expect(markBreached).not.toHaveBeenCalled();
    expect(triggerTatBreach).not.toHaveBeenCalled();
  });

  it("a triggerTatBreach failure does not abort the notification or the sweep", async () => {
    triggerTatBreach.mockRejectedValue(new Error("db down"));

    const result = await runTatEscalationSweep();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(result.escalated).toBe(1);
    expect(result.skipped).toBe(0);
  });
});
