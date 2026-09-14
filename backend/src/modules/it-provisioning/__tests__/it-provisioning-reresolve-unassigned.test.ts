import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A provisioning request created with no owner (`pending_unassigned`, migration 420)
 * had no path back to an assignee:
 *
 *   - provisioning-retry.job.ts only picks employees with NO IT_EMAIL_DOMAIN_ASSET
 *     row (`NOT EXISTS`), and an unassigned request IS such a row.
 *   - No reassign endpoint exists, and NativeITProvisioningTracker renders the
 *     unassigned case as text with no button.
 *
 * Live on 2026-08-26: 34 requests stuck, 44-56 days past SLA, for four roles that
 * all had active holders (wfm 5, it 3, admin 3, hr 16).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { logSensitiveAction } = vi.hoisted(() => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

const { getConfiguredRecipients } = vi.hoisted(() => ({ getConfiguredRecipients: vi.fn() }));
vi.mock("../notification-recipients.service.js", () => ({ getConfiguredRecipients }));

const { createItem, send } = vi.hoisted(() => ({
  createItem: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send } }));
vi.mock("../../../config/env.js", () => ({ env: { FRONTEND_URL: "https://hrms.example" } }));

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("../../communication/notification.gateway.js", () => ({ notificationGateway: { notify } }));

import { reresolveUnassignedRequests, notifyOverdueProvisioning } from "../it-provisioning.service.js";

function unassignedRow(over: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    employee_id: "emp-1",
    task_code: "IT_EMAIL_DOMAIN_ASSET",
    assigned_role: "it",
    request_type: "join",
    employee_code: "MAS001",
    first_name: "Amit",
    branch_id: "br-1",
    ...over,
  };
}

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockClear();
  getConfiguredRecipients.mockReset();
  notify.mockReset();
  createItem.mockClear();
  send.mockClear();
});

describe("reresolveUnassignedRequests", () => {
  it("assigns a request whose role now has a holder, and audits the recovery", async () => {
    execute.mockResolvedValueOnce([[unassignedRow()], []]);          // 1: SELECT pending_unassigned
    getConfiguredRecipients.mockResolvedValueOnce({
      to: [{ userId: "user-it-1", email: "it.spoc@teammas.in" }],
      cc: [],
    });
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);        // 2: UPDATE -> pending

    const out = await reresolveUnassignedRequests();

    expect(out).toMatchObject({ scanned: 1, assigned: 1, stillUnassigned: 0, remaining: 0 });

    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain("SET assigned_user_id = ?, status = 'pending', assignment_exception = 0");
    // Guarded on the old status so a concurrent waive/reassign wins instead of
    // being silently overwritten.
    expect(sql).toContain("AND status = 'pending_unassigned'");
    expect(params).toEqual(["user-it-1", "req-1"]);

    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "it_provisioning_reassigned",
        entity_id: "req-1",
        change_summary: expect.objectContaining({ previous_status: "pending_unassigned" }),
      }),
    );
  });

  it("leaves the request unassigned when the only resolvable recipient is a branch-head escalation", async () => {
    execute.mockResolvedValueOnce([[unassignedRow()], []]);
    // resolveTaskRecipients returns branch_head_escalation with unassigned:true —
    // people to TELL, but nobody to OWN it. Assigning the branch head here would
    // silently make them the actioner of every orphaned IT task.
    getConfiguredRecipients.mockResolvedValueOnce(null);
    execute.mockResolvedValueOnce([[], []]);                          // getUsersForBranchRole -> none
    execute.mockResolvedValueOnce([[{ user_id: "user-bh", email: "bh@teammas.in" }], []]); // branchHeadUsers
    execute.mockResolvedValue([[], []]);                              // any trailing lookups

    const out = await reresolveUnassignedRequests();

    expect(out.assigned).toBe(0);
    expect(out.stillUnassigned).toBe(1);
    expect(logSensitiveAction).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([s]) => String(s).includes("UPDATE it_provisioning_request"))).toBe(false);
  });

  it("caps the batch and reports the deferred remainder instead of dropping it", async () => {
    const many = Array.from({ length: 4 }, (_, i) => unassignedRow({ id: `req-${i + 1}` }));
    execute.mockResolvedValueOnce([many, []]);                        // 1: SELECT returns limit+1 = 4
    getConfiguredRecipients.mockResolvedValue({
      to: [{ userId: "user-it-1", email: "it.spoc@teammas.in" }],
      cc: [],
    });
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);

    const out = await reresolveUnassignedRequests(3);

    expect(out.scanned).toBe(3);
    expect(out.assigned).toBe(3);
    expect(out.remaining).toBe(1);
  });

  it("does not roll back the assignment when notification dispatch fails", async () => {
    execute.mockResolvedValueOnce([[unassignedRow()], []]);
    getConfiguredRecipients.mockResolvedValueOnce({
      to: [{ userId: "user-it-1", email: "it.spoc@teammas.in" }],
      cc: [],
    });
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    createItem.mockRejectedValueOnce(new Error("inbox down"));
    send.mockRejectedValueOnce(new Error("smtp down"));

    const out = await reresolveUnassignedRequests();

    expect(out.assigned).toBe(1);
    expect(out.stillUnassigned).toBe(0);
  });
});

describe("provisioning-retry.job.ts — why the second pass is required", () => {
  const job = readFileSync(
    resolve(process.cwd(), "src/jobs/provisioning-retry.job.ts"),
    "utf8",
  );

  it("still excludes employees that already have a provisioning row, so the first pass can never reach an unassigned request", () => {
    expect(job).toContain("NOT EXISTS");
    expect(job).toContain("pr.task_code = 'IT_EMAIL_DOMAIN_ASSET'");
    // The dispatch loop keys on the ABSENCE of a row. pending_unassigned rows exist.
    expect(job).not.toMatch(/WHERE[\s\S]*status\s*=\s*'pending_unassigned'/);
  });

  it("runs the re-resolution pass and keeps it non-fatal to the dispatch retries", () => {
    expect(job).toContain("reresolveUnassignedRequests()");
    const idx = job.indexOf("reresolveUnassignedRequests()");
    const around = job.slice(idx - 400, idx + 400);
    expect(around).toContain("try {");
    expect(around).toContain("catch");
  });
});

// ── overdue notification ──────────────────────────────────────────────────────

/**
 * `sla_due_at` was written on every request and read in a dozen pull surfaces, but
 * nothing ever pushed it. `provisioning_overdue` sat registered in
 * notification_event_config with zero producers — the same shape TAT_BREACH had.
 */
describe("notifyOverdueProvisioning", () => {
  function overdueRow(over: Record<string, unknown> = {}) {
    return {
      id: "req-9",
      employee_id: "emp-9",
      task_code: "IT_EMAIL_DOMAIN_ASSET",
      assigned_role: "it",
      assigned_user_id: "user-it-1",
      status: "pending",
      sla_due_at: "2026-08-20 10:00:00",
      hours_overdue: 148,
      employee_code: "MAS009",
      first_name: "Neha",
      branch_id: "br-1",
      ...over,
    };
  }

  it("emits one provisioning_overdue event per breached request, keyed so an hourly rescan cannot double-send", async () => {
    execute.mockResolvedValueOnce([[{ floor: "2026-07-31 10:19:16" }], []]);
    execute.mockResolvedValueOnce([[overdueRow()], []]);
    notify.mockResolvedValueOnce({ outcome: "shadow" });

    const out = await notifyOverdueProvisioning();

    expect(out).toMatchObject({ scanned: 1, notified: 1, skipped: 0, remaining: 0 });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: "provisioning_overdue",
        dedupeKey: "it_provisioning_request:req-9:overdue",
        entityType: "it_provisioning_request",
        data: expect.objectContaining({ hours_overdue: 148, unassigned: false }),
      }),
    );
  });

  it("honours the registry backfill floor rather than scanning all history", async () => {
    execute.mockResolvedValueOnce([[{ floor: "2026-07-31 10:19:16" }], []]);
    execute.mockResolvedValueOnce([[], []]);

    await notifyOverdueProvisioning();

    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain("AND r.sla_due_at >= ?");
    expect((params as any[])[0]).toBeInstanceOf(Date);
    expect(((params as any[])[0] as Date).toISOString()).toContain("2026-07-31");
  });

  it("falls back to a 7-day floor, never all history, when the registry has none", async () => {
    execute.mockResolvedValueOnce([[], []]);
    execute.mockResolvedValueOnce([[], []]);

    await notifyOverdueProvisioning();

    const params = execute.mock.calls[1][1] as any[];
    const ageDays = (Date.now() - (params[0] as Date).getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(6.9);
    expect(ageDays).toBeLessThan(7.1);
  });

  it("counts a gateway refusal as skipped rather than notified", async () => {
    execute.mockResolvedValueOnce([[{ floor: "2026-07-31 10:19:16" }], []]);
    execute.mockResolvedValueOnce([[overdueRow()], []]);
    notify.mockResolvedValueOnce({ outcome: "disabled", reason: "event is disabled" });

    const out = await notifyOverdueProvisioning();

    expect(out.notified).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it("caps the batch and reports the deferred remainder", async () => {
    execute.mockResolvedValueOnce([[{ floor: "2026-07-31 10:19:16" }], []]);
    execute.mockResolvedValueOnce([
      Array.from({ length: 4 }, (_, i) => overdueRow({ id: `req-${i}` })),
      [],
    ]);
    notify.mockResolvedValue({ outcome: "shadow" });

    const out = await notifyOverdueProvisioning(3);

    expect(out).toMatchObject({ scanned: 3, notified: 3, remaining: 1 });
  });

  it("excludes actioned and locked rows, so a completed task cannot be chased", async () => {
    execute.mockResolvedValueOnce([[{ floor: "2026-07-31 10:19:16" }], []]);
    execute.mockResolvedValueOnce([[], []]);

    await notifyOverdueProvisioning();

    const sql = String(execute.mock.calls[1][0]);
    expect(sql).toContain("r.status IN ('pending', 'pending_unassigned')");
    expect(sql).toContain("r.locked = 0");
  });
});
