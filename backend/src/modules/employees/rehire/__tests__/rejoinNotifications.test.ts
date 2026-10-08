import { describe, it, expect, vi } from "vitest";
import {
  notifyRejoinRequested, notifyRejoinDecided, notifyRejoinReminder, notifyRejoinEscalation,
  notifyFollowUpAttention, notifyRejoinBlockedAtJoining, type NotifyDeps,
} from "../rejoinNotifications.js";

const ctxRow = {
  id: "r1", employee_id: "e1", proposed_joining_date: "2026-10-10", gap_days: 12, status: "pending",
  reinstatement_reason: "Good record at the branch", raised_by_role: "hr",
  eligibility_status: "review",
  eligibility_snapshot: { status: "review", reasons: [{ code: "ASSETS_UNRETURNED", severity: "review", message: "Company assets were not returned." }] },
  initiated_by: "u-hr", branch_head_remarks: "Reviewed the history", created_days: 3,
  employee_code: "MAS001", employee_name: "Asha Rao", branch_id: "b1", process_id: "p1", branch_name: "Pune", requester_name: "Hema HR",
};

function deps(row: unknown = ctxRow, outcome = "sent") {
  const notify = vi.fn(async () => ({ outcome }));
  return {
    notify,
    d: {
      db: { execute: vi.fn(async () => [row ? [row] : [], []]) },
      gateway: { notify },
    } as unknown as NotifyDeps,
  };
}

describe("notifyRejoinRequested", () => {
  it("notifies the branch head of the employee's branch, once per request", async () => {
    const { notify, d } = deps();
    expect(await notifyRejoinRequested("r1", d)).toBe(true);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_requested");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:requested");
    expect(arg.context).toMatchObject({ employeeId: "e1", branchId: "b1", processId: "p1" });
    expect(arg.entityType).toBe("employee_reactivation_request");
    expect(arg.entityId).toBe("r1");
    expect(arg.data).toMatchObject({ employee_name: "Asha Rao", employee_code: "MAS001", branch_name: "Pune", requester_name: "Hema HR", requester_role: "hr", gap_days: 12, eligibility_status: "review", proposed_joining_date: "2026-10-10", request_id: "r1" });
    expect(arg.data.review_reasons).toContain("Company assets were not returned.");
    // The email's button lands on this request's review page, not the list.
    expect(arg.data.action_url).toBe("/employees/reactivation/r1/review");
    expect(arg.specOverride).toBeUndefined();
  });

  it("returns false and never throws when the request cannot be found", async () => {
    const { notify, d } = deps(null);
    expect(await notifyRejoinRequested("nope", d)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns false and never throws when the gateway throws", async () => {
    const d = { db: { execute: vi.fn(async () => [[ctxRow], []]) }, gateway: { notify: vi.fn(async () => { throw new Error("smtp down"); }) } } as unknown as NotifyDeps;
    await expect(notifyRejoinRequested("r1", d)).resolves.toBe(false);
  });

  it("counts shadow as handled, and disabled / duplicate as not sent", async () => {
    expect(await notifyRejoinRequested("r1", deps(ctxRow, "shadow").d)).toBe(true);
    expect(await notifyRejoinRequested("r1", deps(ctxRow, "disabled").d)).toBe(false);
    expect(await notifyRejoinRequested("r1", deps(ctxRow, "duplicate").d)).toBe(false);
  });
});

describe("notifyRejoinDecided", () => {
  it("addresses the requester with HR and branch payroll in cc, and dedupes per decision", async () => {
    const { notify, d } = deps();
    await notifyRejoinDecided("r1", "approved", d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_decided");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:decided:approved");
    expect(arg.specOverride.to).toEqual([{ kind: "user", userId: "u-hr" }]);
    expect(arg.specOverride.cc).toEqual([
      { kind: "role_scope", roleKeys: ["hr"], scope: { type: "all" }, limit: 10 },
      { kind: "payroll_hr", branchId: "b1" },
    ]);
    expect(arg.data).toMatchObject({ decision: "approved", remarks: "Reviewed the history" });
  });

  it("a rejection is a separate notification from an approval", async () => {
    const { notify, d } = deps();
    await notifyRejoinDecided("r1", "rejected", d);
    expect((notify.mock.calls[0]![0] as any).dedupeKey).toBe("rejoin_request:r1:decided:rejected");
  });
});

describe("notifyRejoinReminder / Escalation", () => {
  it("puts the reminder number in the dedupe key so each reminder fires once", async () => {
    const { notify, d } = deps();
    await notifyRejoinReminder("r1", 2, d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_pending_reminder");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:reminder:2");
    expect(arg.data).toMatchObject({ reminder_no: 2, days_waiting: 3 });
  });

  it("escalation goes to HR through the configured spec and fires once", async () => {
    const { notify, d } = deps();
    await notifyRejoinEscalation("r1", d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_pending_escalation");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:escalated");
    expect(arg.specOverride).toBeUndefined();
  });
});

describe("notifyFollowUpAttention", () => {
  it("lists only the failed steps, and does nothing when all steps passed", async () => {
    const { notify, d } = deps();
    expect(await notifyFollowUpAttention("r1", [{ step: "auth", ok: true }], d)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    await notifyFollowUpAttention("r1", [
      { step: "auth", ok: false, detail: "No login account is linked" },
      { step: "lms", ok: true },
      { step: "it_provisioning", ok: false, detail: "IT down" },
    ], d);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_followup_attention");
    expect(arg.dedupeKey).toBe("rejoin_request:r1:followup_attention");
    expect(arg.data.failed_count).toBe(2);
    expect(arg.data.failed_steps).toContain("auth: No login account is linked");
    expect(arg.data.failed_steps).toContain("it_provisioning: IT down");
    expect(arg.data.failed_steps).not.toContain("lms");
  });
});

describe("notifyRejoinBlockedAtJoining", () => {
  it("alerts HR once per candidate with the former employee's details", async () => {
    const notify = vi.fn(async () => ({ outcome: "sent" }));
    const d = { db: { execute: vi.fn(async () => [[{ candidate_name: "Asha Rao", branch_id: "b1" }], []]) }, gateway: { notify } } as unknown as NotifyDeps;
    const ok = await notifyRejoinBlockedAtJoining({
      candidateId: "c1",
      leaver: { employeeId: "e1", employeeCode: "MAS001", fullName: "Asha Rao", employmentStatus: "resigned" },
      message: "Raise a rejoin request for MAS001.",
    }, d);
    expect(ok).toBe(true);
    const arg = notify.mock.calls[0]![0] as any;
    expect(arg.eventCode).toBe("rejoin_blocked_at_joining");
    expect(arg.dedupeKey).toBe("ats_candidate:c1:rejoin_blocked");
    expect(arg.data).toMatchObject({ candidate_name: "Asha Rao", employee_code: "MAS001", employment_status: "resigned", outcome_message: "Raise a rejoin request for MAS001." });
  });

  it("never throws", async () => {
    const d = { db: { execute: vi.fn(async () => { throw new Error("db"); }) }, gateway: { notify: vi.fn() } } as unknown as NotifyDeps;
    await expect(notifyRejoinBlockedAtJoining({ candidateId: "c1", leaver: { employeeId: "e", employeeCode: "X", fullName: "Y", employmentStatus: "z" }, message: "m" }, d)).resolves.toBe(false);
  });
});
