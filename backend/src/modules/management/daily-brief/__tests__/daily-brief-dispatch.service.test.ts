import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { send } = vi.hoisted(() => ({ send: vi.fn(async () => ({ queued: 1, failed: 0, dispatch_ids: ["d-1"], portal_created: 0 })) }));
vi.mock("../../../communication/dispatch.service.js", () => ({
  dispatchService: { send },
  resolveEmailContact: (emp: { email: string | null }) => emp.email,
}));

const { renderTemplate } = vi.hoisted(() => ({
  renderTemplate: vi.fn(async () => ({ html: "<p>hi</p>", text: "hi", subject: undefined })),
}));
vi.mock("../../../communication/template.service.js", () => ({
  templateService: { renderTemplate },
}));

const { getDispatchBlock } = vi.hoisted(() => ({ getDispatchBlock: vi.fn(async () => ({ blocked: false })) }));
vi.mock("../../../../shared/notification-dispatch-block.js", () => ({ getDispatchBlock }));

// dispatchDailyBrief composes buildDailyBriefForEmployee, which in turn composes the
// recipient resolver and the aggregator — mock those two sibling modules directly
// rather than the whole dispatch-service module under test.
vi.mock("../daily-brief-recipient.resolver.js", () => ({
  resolveDailyBriefRecipient: vi.fn(async (employeeId: string) => ({
    ok: true,
    recipient: {
      employeeId, userId: "user-1", fullName: "Priya Sharma", role: "team_leader",
      scopeLabel: "Your direct/indirect reports", teamEmployeeIds: [], email: "priya@masindia.com",
    },
  })),
}));
vi.mock("../daily-brief-aggregator.service.js", () => ({
  buildManagerDailyBrief: vi.fn(async (recipient: any, businessDate: string, generatedAtIST: string) => ({
    recipient, businessDate, generatedAtIST,
    attendance: { recordDate: businessDate, present: 0, halfDay: 0, absent: 0, missingPunch: 0, lateCount: 0, expectedToWork: 0, attendancePct: null },
    hygieneIssues: [], actions: [], payrollReadiness: null, sourceHealth: [],
  })),
}));

import { dailyBriefEventCode, dispatchDailyBrief } from "../daily-brief-dispatch.service.js";

describe("daily-brief-dispatch.service: idempotency", () => {
  beforeEach(() => {
    execute.mockReset();
    send.mockClear();
    getDispatchBlock.mockReset().mockResolvedValue({ blocked: false });
  });

  it("skips dispatch when dispatch_log already has a sent row for this event+recipient", async () => {
    execute.mockResolvedValue([[{ id: "existing-log-row" }]]); // alreadyDispatched() finds a row

    const result = await dispatchDailyBrief("emp-1", { businessDate: "2026-08-18", dryRun: false });

    expect(result.status).toBe("skipped_already_sent");
    expect(send).not.toHaveBeenCalled();
  });

  it("dispatches when no prior sent/delivered/skipped row exists", async () => {
    execute.mockResolvedValue([[]]); // alreadyDispatched() finds nothing

    const result = await dispatchDailyBrief("emp-1", { businessDate: "2026-08-18", dryRun: false });

    expect(result.status).toBe("dispatched");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_employee_ids: ["emp-1"],
        event_code: dailyBriefEventCode("2026-08-18"),
        channel: "email",
      }),
    );
  });

  it("dryRun (the default) never calls dispatchService.send at all", async () => {
    const result = await dispatchDailyBrief("emp-1", { businessDate: "2026-08-18" });

    expect(result.status).toBe("dry_run");
    expect(send).not.toHaveBeenCalled();
  });

  it("respects an operator dispatch block instead of sending", async () => {
    execute.mockResolvedValue([[]]);
    getDispatchBlock.mockResolvedValue({ blocked: true, scope: "global", reason: "incident" });

    const result = await dispatchDailyBrief("emp-1", { businessDate: "2026-08-18", dryRun: false });

    expect(result.status).toBe("skipped_blocked");
    expect(send).not.toHaveBeenCalled();
  });
});
