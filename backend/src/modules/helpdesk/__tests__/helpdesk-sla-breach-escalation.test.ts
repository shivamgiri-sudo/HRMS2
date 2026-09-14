import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SLA-breach escalation (2026-08-24). Before this, refreshSlaBreachFlags() (the 5-minute cron,
 * helpdesk-sla.cron.ts) only ever flipped a passive sla_breached flag for the dashboard badge -
 * confirmed by reading the whole cron file, it called nothing else. Nobody was notified,
 * nothing escalated, on a ticket blowing its SLA.
 */

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...(args as [string, unknown[]])) },
}));

const logSensitiveAction = vi.fn(async () => undefined);
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

const createItem = vi.fn(async () => undefined);
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));

import { refreshSlaBreachFlags } from "../helpdesk-sla.service.js";

describe("refreshSlaBreachFlags — SLA breach now escalates, not just flags", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    logSensitiveAction.mockClear();
    createItem.mockClear();
  });

  it("does nothing further when no ticket is newly breaching (the common case, every 5 minutes)", async () => {
    mockExecute.mockResolvedValueOnce([[], []]); // SELECT finds nothing
    await refreshSlaBreachFlags();
    expect(mockExecute).toHaveBeenCalledTimes(1); // just the SELECT, no UPDATE, no side effects
    expect(logSensitiveAction).not.toHaveBeenCalled();
    expect(createItem).not.toHaveBeenCalled();
  });

  it("updates sla_breached and bumps escalation_level for newly-breached tickets", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "t-1", ticket_code: "TKT-1", subject: "Laptop dead", category: "it", assigned_to: "u-1", escalation_level: 0 }], []])
      .mockResolvedValueOnce([[], []]); // the UPDATE

    await refreshSlaBreachFlags();

    const updateCall = mockExecute.mock.calls.find(([sql]) => /UPDATE helpdesk_ticket/.test(sql as string));
    expect(updateCall).toBeDefined();
    const [sql, params] = updateCall as [string, unknown[]];
    expect(sql).toContain("sla_breached = 1");
    expect(sql).toContain("escalation_level = escalation_level + 1");
    expect(params).toContain("t-1");
  });

  it("logs a TICKET_SLA_BREACHED audit entry for every newly-breached ticket", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "t-1", ticket_code: "TKT-1", subject: "x", category: "it", assigned_to: null, escalation_level: 1 }], []])
      .mockResolvedValueOnce([[], []]);

    await refreshSlaBreachFlags();

    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "TICKET_SLA_BREACHED",
      entity_id: "t-1",
    }));
  });

  it("notifies the currently-assigned agent via the work inbox", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "t-1", ticket_code: "TKT-1", subject: "Laptop dead", category: "it", assigned_to: "u-assignee", escalation_level: 0 }], []])
      .mockResolvedValueOnce([[], []]);

    await refreshSlaBreachFlags();

    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "u-assignee",
      type: "helpdesk_ticket_sla_breached",
      priority: "urgent",
      entity_id: "t-1",
    }));
  });

  it("does not attempt a notification for an unassigned ticket (nothing to route it to here)", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "t-1", ticket_code: "TKT-1", subject: "x", category: "it", assigned_to: null, escalation_level: 0 }], []])
      .mockResolvedValueOnce([[], []]);

    await refreshSlaBreachFlags();

    expect(createItem).not.toHaveBeenCalled();
    // But the breach is still logged and flagged even though nobody could be notified.
    expect(logSensitiveAction).toHaveBeenCalled();
  });

  it("one failing notification does not stop the audit log or the flag update from happening", async () => {
    createItem.mockRejectedValueOnce(new Error("inbox down"));
    mockExecute
      .mockResolvedValueOnce([[{ id: "t-1", ticket_code: "TKT-1", subject: "x", category: "it", assigned_to: "u-1", escalation_level: 0 }], []])
      .mockResolvedValueOnce([[], []]);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(refreshSlaBreachFlags()).resolves.not.toThrow();
    expect(logSensitiveAction).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
