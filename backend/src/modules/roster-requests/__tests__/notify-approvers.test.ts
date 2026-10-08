import { describe, expect, it, vi } from "vitest";
import {
  approverUserIdsForRequest,
  notifyApproversOfRequest,
  notifyApproversAutoApproved,
  pendingPriority,
  ROSTER_REQUEST_PENDING_TYPE,
} from "../roster-requests.notify.js";

type Call = { sql: string; params: unknown[] };

function fakeExec(opts: { employee?: Record<string, unknown> | null; wfm?: string[]; managerUser?: string | null; failOn?: RegExp } = {}) {
  const calls: Call[] = [];
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (opts.failOn && opts.failOn.test(sql)) throw new Error("db down");
    if (sql.includes("FROM employees WHERE id = ?") && sql.includes("reporting_manager_id")) {
      return [opts.employee === null ? [] : [opts.employee ?? { branch_id: "b1", process_id: "p1", reporting_manager_id: "m1" }], []];
    }
    if (sql.includes("SELECT user_id FROM employees")) {
      return [opts.managerUser === null ? [] : [{ user_id: opts.managerUser ?? "u-mgr" }], []];
    }
    if (sql.includes("FROM user_roles")) return [(opts.wfm ?? ["u-wfm1", "u-wfm2"]).map((user_id) => ({ user_id })), []];
    return [{ affectedRows: 1 }, []];
  });
  return { calls, execute };
}

const NOW = new Date("2026-10-02T06:00:00Z");

describe("pendingPriority", () => {
  it("is high when the shift date is within 24h, else normal", () => {
    expect(pendingPriority("2026-10-03", NOW)).toBe("high");
    expect(pendingPriority("2026-10-02", NOW)).toBe("high");
    expect(pendingPriority("2026-10-05", NOW)).toBe("normal");
  });
  it("treats the shift day as IST midnight, not UTC midnight", () => {
    // 2026-10-03 00:00 IST is 2026-10-02T18:30Z: 23.5h after this instant => high.
    // (UTC midnight would be 29h away => normal.)
    expect(pendingPriority("2026-10-03", new Date("2026-10-01T19:00:00Z"))).toBe("high");
  });
});

describe("approverUserIdsForRequest", () => {
  it("unions WFM recipients for branch/process with the reporting manager's user", async () => {
    const exec = fakeExec();
    const ids = await approverUserIdsForRequest({ employeeId: "e1" }, exec as any);
    expect(ids.sort()).toEqual(["u-mgr", "u-wfm1", "u-wfm2"]);
    const wfm = exec.calls.find((c) => c.sql.includes("FROM user_roles"))!;
    expect(wfm.params).toContain("b1");
    expect(wfm.params).toContain("p1");
  });

  it("prefers explicit process/branch over the employee row", async () => {
    const exec = fakeExec();
    await approverUserIdsForRequest({ employeeId: "e1", processId: "p9", branchId: "b9" }, exec as any);
    const wfm = exec.calls.find((c) => c.sql.includes("FROM user_roles"))!;
    expect(wfm.params).toContain("b9");
    expect(wfm.params).toContain("p9");
  });

  it("never includes the requester's own user", async () => {
    const exec = fakeExec({
      wfm: ["u-self", "u-wfm1"],
      employee: { user_id: "u-self", branch_id: "b1", process_id: "p1", reporting_manager_id: "m1" },
    });
    const ids = await approverUserIdsForRequest({ employeeId: "e1" }, exec as any);
    expect(ids).not.toContain("u-self");
    expect(ids).toContain("u-wfm1");
  });
});

describe("notifyApproversOfRequest", () => {
  const base = { kind: "swap" as const, sourceId: "11111111-2222-3333-4444-555555555555", employeeId: "e1", date: "2026-10-03", summary: "Shift swap requested" };

  it("writes one ROSTER_REQUEST_PENDING item per approver with the decide-matching entity", async () => {
    const exec = fakeExec();
    await notifyApproversOfRequest(base, exec as any, NOW);
    const inserts = exec.calls.filter((c) => c.sql.includes("INSERT INTO work_inbox_item"));
    expect(inserts).toHaveLength(3);
    for (const ins of inserts) {
      expect(ins.params).toContain(ROSTER_REQUEST_PENDING_TYPE);
      expect(ins.params).toContain("roster_request_pending:swap");
      expect(ins.params).toContain(base.sourceId);
      expect(ins.params).toContain(`/wfm/roster-requests?kind=swap&id=${base.sourceId}`);
      expect(ins.params).toContain("high");
    }
  });

  it("uses normal priority for a shift more than 24h away", async () => {
    const exec = fakeExec();
    await notifyApproversOfRequest({ ...base, date: "2026-10-09" }, exec as any, NOW);
    const ins = exec.calls.find((c) => c.sql.includes("INSERT INTO work_inbox_item"))!;
    expect(ins.params).toContain("normal");
  });

  it("never throws when the DB fails", async () => {
    const exec = fakeExec({ failOn: /INSERT INTO work_inbox_item/ });
    await expect(notifyApproversOfRequest(base, exec as any, NOW)).resolves.toBeUndefined();
    const exec2 = { execute: vi.fn(async () => { throw new Error("down"); }) };
    await expect(notifyApproversOfRequest(base, exec2 as any, NOW)).resolves.toBeUndefined();
  });

  it("does nothing when nobody is in scope", async () => {
    const exec = fakeExec({ wfm: [], managerUser: null, employee: { branch_id: null, process_id: null, reporting_manager_id: null } });
    await notifyApproversOfRequest(base, exec as any, NOW);
    expect(exec.calls.some((c) => c.sql.includes("INSERT INTO work_inbox_item"))).toBe(false);
  });
});

describe("notifyApproversAutoApproved", () => {
  it("writes FYI items with the auto entity type", async () => {
    const exec = fakeExec();
    await notifyApproversAutoApproved({ kind: "weekoff_rejection", sourceId: "a1", employeeId: "e1", date: "2026-10-09", summary: "x" }, exec as any);
    const inserts = exec.calls.filter((c) => c.sql.includes("INSERT INTO work_inbox_item"));
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts[0].params).toContain("ROSTER_REQUEST_AUTO_APPROVED");
    expect(inserts[0].params).toContain("roster_request_auto:weekoff_rejection");
  });
});
